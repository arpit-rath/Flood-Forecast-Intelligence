// API contract consumed by the frontend.
//
// Derived from Architecture.md §3 (domain model) and §7 (API surface) and
// Agents.md §2 (observation schema). Fields marked "frontend assumption" are
// not yet pinned in Architecture.md and are listed in frontend/README.md.

export type ISOTime = string;
export type LngLat = [number, number];

export type RiskClass = 'low' | 'watch' | 'high' | 'unknown';
export type WeatherMode = 'scenario' | 'live';
export type FeatureKey = 'R' | 'T' | 'D' | 'O';
export type TravelMode = 'pedestrian' | 'car';

export interface ApiErrorBody {
  code: string;
  message: string;
  retryable: boolean;
  requestId: string;
}

export class ApiError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly requestId: string;

  constructor(body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.code = body.code;
    this.retryable = body.retryable;
    this.requestId = body.requestId;
  }
}

// ---- GET /v1/pilot ----

export interface SegmentProperties {
  id: string;
  name: string;
  fromNode: string;
  toNode: string;
  lengthM: number;
  terrainPrior: number | null;
  drainageVulnerability: number | null;
  source: string;
  bundleVersion: string;
}

export interface DrainProperties {
  id: string;
  label: string;
  affectedSegmentIds: string[];
  illustrative: boolean;
}

export interface Feature<G, P> {
  type: 'Feature';
  id: string;
  geometry: G;
  properties: P;
}

export interface FeatureCollection<G, P> {
  type: 'FeatureCollection';
  features: Feature<G, P>[];
}

export interface LineStringGeometry {
  type: 'LineString';
  coordinates: LngLat[];
}

export interface PointGeometry {
  type: 'Point';
  coordinates: LngLat;
}

export interface PilotPlace {
  id: string;
  label: string;
  point: LngLat;
}

export interface DataSource {
  id: string;
  name: string;
  licence: string;
  url?: string;
  note?: string;
}

export interface PilotResponse {
  pilotId: string;
  name: string;
  bundleVersion: string;
  preparedAt: ISOTime;
  mapUpdatedAt: ISOTime;
  /** Shown when geometry is illustrative rather than surveyed. */
  geometryNote?: string;
  /** [west, south, east, north] */
  bounds: [number, number, number, number];
  center: LngLat;
  segments: FeatureCollection<LineStringGeometry, SegmentProperties>;
  drains: FeatureCollection<PointGeometry, DrainProperties>;
  /** Frontend assumption: named pilot points for route search. */
  places: PilotPlace[];
  travelModes: TravelMode[];
  sources: DataSource[];
}

// ---- GET /v1/snapshots/current?mode= ----

export interface WeatherSnapshot {
  mode: WeatherMode;
  precipitationMmH: number | null;
  validAt: ISOTime;
  fetchedAt: ISOTime;
  provider: string;
  scenarioId?: string;
  scenarioLabel?: string;
  stale: boolean;
}

export interface FeatureValue {
  value: number | null;
  weight: number;
  source: string | null;
  observedAt: ISOTime | null;
}

export type ClosureStatus = 'confirmed' | 'cleared';

export interface Closure {
  segmentId: string;
  status: ClosureStatus;
  reason: string;
  setBy: string;
  setAt: ISOTime;
  expiresAt?: ISOTime | null;
}

export interface SegmentRisk {
  segmentId: string;
  score: number | null;
  class: RiskClass;
  coverage: number;
  lowConfidence: boolean;
  lowConfidenceReasons: string[];
  features: Record<FeatureKey, FeatureValue>;
  missing: FeatureKey[];
  evidenceIds: string[];
  closure: Closure | null;
  computedAt: ISOTime;
  modelVersion: string;
}

export interface RiskSnapshotResponse {
  snapshotId: string;
  mode: WeatherMode;
  computedAt: ISOTime;
  modelVersion: string;
  bundleVersion: string;
  /** True when this is the last timestamped snapshot after a provider failure. */
  stale: boolean;
  weather: WeatherSnapshot;
  thresholds: { watch: number; high: number; lowConfidenceCoverage: number };
  acceptedReportIds: string[];
  segments: SegmentRisk[];
}

// ---- Reports ----

export type ReviewStatus =
  | 'analysis_pending'
  | 'pending_review'
  | 'needs_manual_review'
  | 'accepted'
  | 'rejected';

export type VisibleWater = 'none' | 'possible' | 'clear' | 'uncertain';
export type DrainState = 'blocked' | 'clear' | 'not_visible' | 'uncertain';
export type Hazard = 'debris' | 'open_manhole' | 'stranded_vehicle' | 'person_in_water' | 'other';
export type AccessConcern = 'none' | 'possible' | 'clear' | 'uncertain';

/** Observation Agent output schema (Agents.md §2). */
export interface Observation {
  visible_water: VisibleWater;
  drain_state: DrainState;
  visible_hazards: Hazard[];
  access_concern: AccessConcern;
  confidence: number;
  evidence_summary: string;
  needs_human_review: boolean;
}

export interface ReportAnalysis {
  status: 'pending' | 'complete' | 'failed';
  /** 'bedrock' for a real model call; 'fixture' for mock data. */
  provider: 'bedrock' | 'fixture';
  model: string | null;
  completedAt: ISOTime | null;
  failureReason: string | null;
}

export interface ReportReview {
  decision: 'accept' | 'reject';
  reviewedAt: ISOTime;
  reviewer: string;
}

export interface Report {
  id: string;
  segmentId: string;
  point: LngLat;
  createdAt: ISOTime;
  capturedAt: ISOTime | null;
  imageKey: string;
  /** Short-lived URL to the metadata-stripped display derivative, if any. */
  imageUrl: string | null;
  note: string;
  reviewStatus: ReviewStatus;
  analysis: ReportAnalysis;
  observations: Observation | null;
  modelConfidence: number | null;
  source: 'resident_upload' | 'fixture';
  review: ReportReview | null;
}

export interface UploadUrlRequest {
  contentType: string;
  sizeBytes: number;
}

export interface UploadUrlResponse {
  uploadUrl: string;
  imageKey: string;
  expiresAt: ISOTime;
  maxBytes: number;
}

export interface CreateReportRequest {
  imageKey: string;
  segmentId: string;
  point: LngLat;
  note: string;
  capturedAt: ISOTime | null;
  consentPublicDerivative: boolean;
  idempotencyKey: string;
}

export interface ReviewRequest {
  decision: 'accept' | 'reject';
}

export interface ReviewResponse {
  report: Report;
  /** Snapshot produced by the recalculation, when the decision changed scores. */
  snapshotId: string | null;
  /** Frontend assumption: explanation when no recalculation was produced. */
  note?: string;
}

// ---- POST /v1/routes/compare ----

export interface RouteCompareRequest {
  originPlaceId: string;
  destinationPlaceId: string;
  travelMode: TravelMode;
  snapshotId: string;
}

export interface RouteCandidate {
  id: string;
  label: string;
  geometry: LineStringGeometry;
  distanceM: number;
  travelMinutes: number;
  segmentIds: string[];
  exposure: number | null;
  maxClass: RiskClass;
  unknownShare: number;
  flaggedSegmentIds: string[];
  blocked: boolean;
  blockedSegmentIds: string[];
  unassessed: boolean;
  unmatchedShare: number;
  isFastest: boolean;
}

export type RouteOutcome =
  | 'lower_exposure_recommended'
  | 'fastest_default'
  | 'no_lower_exposure'
  | 'unavailable';

export interface RouteProvenance {
  provider: 'amazon_location' | 'pilot_replay';
  label: string;
  snapshotId: string;
  modelVersion: string;
}

export interface RouteComparison {
  comparisonId: string;
  snapshotId: string;
  origin: string;
  destination: string;
  travelMode: TravelMode;
  status: 'ok' | 'unavailable';
  outcome: RouteOutcome;
  recommendedCandidateId: string | null;
  fastestCandidateId: string;
  exposureThreshold: number;
  candidates: RouteCandidate[];
  computedAt: ISOTime;
  provenance: RouteProvenance;
}

// ---- POST /v1/interventions/compare ----

export interface InterventionCompareRequest {
  drainIds: [string, string];
  baselineSnapshotId: string;
  routeComparisonId: string;
  selectedRouteId: string;
  idempotencyKey: string;
}

export interface SegmentChange {
  segmentId: string;
  beforeScore: number | null;
  afterScore: number | null;
  beforeClass: RiskClass;
  afterClass: RiskClass;
  drainageBefore: number | null;
  drainageAfter: number | null;
}

export interface InterventionOption {
  runId: string;
  rank: number;
  drainId: string;
  drainLabel: string;
  affectedSegmentIds: string[];
  routeExposureBefore: number | null;
  routeExposureAfter: number | null;
  exposureReduction: number;
  segmentsLeavingHigh: number;
  affectedRouteCount: number;
  segmentChanges: SegmentChange[];
  routeOutcomeAfter: {
    outcome: RouteOutcome;
    recommendedCandidateId: string | null;
    candidates: { id: string; exposure: number | null; blocked: boolean }[];
  };
  hasEstimatedBenefit: boolean;
}

export interface InterventionComparison {
  comparisonId: string;
  baselineSnapshotId: string;
  routeComparisonId: string;
  selectedRouteId: string;
  selectedRouteBlocked: boolean;
  drainIds: string[];
  options: InterventionOption[];
  rankBasis: 'route_exposure_reduction' | 'segments_leaving_high' | 'drain_id';
  noEstimatedBenefit: boolean;
  baselineRouteOutcome: { outcome: RouteOutcome; recommendedCandidateId: string | null };
  assumptions: {
    drainageReduction: number;
    floor: number;
    unchangedInputs: FeatureKey[];
    statements: string[];
  };
  createdAt: ISOTime;
  modelVersion: string;
}
