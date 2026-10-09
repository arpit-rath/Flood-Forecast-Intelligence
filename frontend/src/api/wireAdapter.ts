import type * as Wire from '../../../contracts/types';
import type {
  FeatureKey,
  InterventionCompareRequest,
  InterventionComparison,
  LngLat,
  PilotResponse,
  RiskClass,
  RiskSnapshotResponse,
  RouteCompareRequest,
  RouteComparison,
  TravelMode,
} from './types';

const FEATURE_WEIGHTS: Record<FeatureKey, number> = { R: 0.35, T: 0.25, D: 0.2, O: 0.2 };
const FEATURES: FeatureKey[] = ['R', 'T', 'D', 'O'];

const riskClass = (value: Wire.RiskClass): RiskClass => value.toLowerCase() as RiskClass;

export function toWireTravelMode(mode: TravelMode): Wire.RouteQuery['travelMode'] {
  return mode === 'pedestrian' ? 'Pedestrian' : 'Car';
}

export function adaptPilot(raw: Wire.PilotResponse): PilotResponse {
  const points = raw.segments.flatMap((segment) => segment.geometry);
  const west = Math.min(...points.map((point) => point[0]));
  const east = Math.max(...points.map((point) => point[0]));
  const south = Math.min(...points.map((point) => point[1]));
  const north = Math.max(...points.map((point) => point[1]));
  const segmentsById = new Map(raw.segments.map((segment) => [segment.id, segment]));
  const nodes = new Map<string, LngLat>();
  for (const segment of raw.segments) {
    nodes.set(segment.fromNode, segment.geometry[0]);
    nodes.set(segment.toNode, segment.geometry[1]);
  }
  const place = (id: string, role: string) => {
    const point = nodes.get(id);
    if (!point) throw new Error(`Pilot route node ${id} has no geometry`);
    return { id, label: `${role} · ${id}`, point };
  };

  return {
    pilotId: raw.id,
    name: raw.label,
    bundleVersion: raw.bundleVersion,
    preparedAt: raw.validAt,
    mapUpdatedAt: raw.validAt,
    geometryNote: 'Synthetic pilot graph; road and drain locations are illustrative, not surveyed.',
    bounds: [west, south, east, north],
    center: [(west + east) / 2, (south + north) / 2],
    segments: {
      type: 'FeatureCollection',
      features: raw.segments.map((segment) => ({
        type: 'Feature',
        id: segment.id,
        geometry: { type: 'LineString', coordinates: segment.geometry },
        properties: { ...segment, name: segment.id },
      })),
    },
    drains: {
      type: 'FeatureCollection',
      features: raw.drains.map((drain) => {
        const affected = drain.affectedSegmentIds.map((id) => segmentsById.get(id)).filter((segment): segment is Wire.Segment => Boolean(segment));
        const ends = affected.flatMap((segment) => segment.geometry);
        if (!ends.length) throw new Error(`Drain ${drain.id} has no mapped affected segment`);
        const point: LngLat = [
          ends.reduce((sum, end) => sum + end[0], 0) / ends.length,
          ends.reduce((sum, end) => sum + end[1], 0) / ends.length,
        ];
        return {
          type: 'Feature', id: drain.id,
          geometry: { type: 'Point', coordinates: point },
          properties: { id: drain.id, label: drain.label, affectedSegmentIds: drain.affectedSegmentIds, illustrative: true },
        };
      }),
    },
    places: [
      place(raw.routeQuery.originNodeId, 'Start node'),
      place(raw.routeQuery.destinationNodeId, 'Destination node'),
    ],
    travelModes: ['pedestrian', 'car'],
    sources: [{ id: 'fixture', name: raw.source, licence: 'Synthetic scenario', note: 'Illustrative pilot data; not a live forecast.' }],
  };
}

export function adaptSnapshot(raw: Wire.RiskSnapshot, pilot?: Wire.PilotResponse): RiskSnapshotResponse {
  const segmentSources = new Map(pilot?.segments.map((segment) => [segment.id, segment.source]) ?? []);
  const evidenceIds = new Set(raw.segments.flatMap((segment) => segment.evidenceIds));
  return {
    snapshotId: raw.id,
    mode: raw.mode.toLowerCase() as RiskSnapshotResponse['mode'],
    computedAt: raw.computedAt,
    modelVersion: raw.modelVersion,
    bundleVersion: raw.bundleVersion,
    stale: raw.weatherStale,
    weather: {
      ...raw.weather,
      mode: raw.weather.mode.toLowerCase() as RiskSnapshotResponse['mode'],
      scenarioLabel: raw.mode === 'Scenario' ? `Scenario: ${raw.weather.precipitationMmH ?? 'unknown'} mm/h rainfall` : undefined,
      stale: raw.weatherStale,
    },
    thresholds: { watch: 0.35, high: 0.6, lowConfidenceCoverage: 0.8 },
    acceptedReportIds: [...evidenceIds].sort(),
    segments: raw.segments.map((risk) => {
      const reasons: string[] = [];
      if (risk.coverage < 0.8) reasons.push('coverage_below_threshold');
      if (raw.weatherStale) reasons.push('weather_stale');
      if (risk.confidence === 'Low' && reasons.length === 0) reasons.push('report_stale');
      const features = Object.fromEntries(FEATURES.map((key) => {
        const value = risk.features[key];
        const source = value === null ? null : key === 'R' ? raw.weather.provider
          : key === 'O' ? 'Accepted report evidence' : segmentSources.get(risk.segmentId) ?? 'Pilot fixture';
        return [key, { value, weight: FEATURE_WEIGHTS[key], source, observedAt: key === 'R' && value !== null ? raw.weather.validAt : null }];
      })) as RiskSnapshotResponse['segments'][number]['features'];
      return {
        segmentId: risk.segmentId,
        score: risk.score,
        class: riskClass(risk.class),
        coverage: risk.coverage,
        lowConfidence: risk.confidence === 'Low',
        lowConfidenceReasons: reasons,
        features,
        missing: risk.missingFeatures,
        evidenceIds: risk.evidenceIds,
        closure: risk.isClosed || risk.roadStatus === 'Closed' ? { segmentId: risk.segmentId, status: 'confirmed' } : null,
        computedAt: risk.computedAt,
        modelVersion: risk.modelVersion,
      };
    }),
  };
}

export function adaptRoutes(
  raw: Wire.RouteComparison, req: RouteCompareRequest, snapshot: Wire.RiskSnapshot,
): RouteComparison {
  const risks = new Map(snapshot.segments.map((risk) => [risk.segmentId, risk]));
  const available = raw.candidates.length > 0 && raw.fastestRouteId !== null;
  const outcome = !available ? 'unavailable'
    : raw.recommendedRouteId && raw.recommendedRouteId !== raw.fastestRouteId ? 'lower_exposure_recommended'
      : raw.candidates.every((candidate) => candidate.exposure === null) ? 'no_lower_exposure' : 'fastest_default';
  return {
    comparisonId: `${raw.snapshotId}:${req.originPlaceId}:${req.destinationPlaceId}:${req.travelMode}`,
    snapshotId: raw.snapshotId,
    origin: req.originPlaceId,
    destination: req.destinationPlaceId,
    travelMode: req.travelMode,
    status: available ? 'ok' : 'unavailable',
    outcome,
    recommendedCandidateId: raw.recommendedRouteId,
    fastestCandidateId: raw.fastestRouteId,
    exposureThreshold: 0.1,
    candidates: raw.candidates.map((candidate) => ({
      id: candidate.id,
      label: `Route ${candidate.id}`,
      geometry: candidate.geometry,
      distanceM: candidate.distanceM,
      travelMinutes: candidate.travelMinutes,
      segmentIds: candidate.segmentIds,
      exposure: candidate.exposure,
      maxClass: riskClass(candidate.highestClass),
      unknownShare: candidate.unknownShare,
      flaggedSegmentIds: candidate.segmentIds.filter((id) => risks.get(id)?.class === 'High'),
      blocked: candidate.blocked,
      blockedSegmentIds: candidate.segmentIds.filter((id) => risks.get(id)?.isClosed),
      unassessed: candidate.unknownShare > 0.2,
      unmatchedShare: 0,
      isFastest: candidate.id === raw.fastestRouteId,
    })),
    computedAt: snapshot.computedAt,
    provenance: { provider: 'pilot_replay', label: raw.provenance, snapshotId: raw.snapshotId, modelVersion: snapshot.modelVersion },
  };
}

export function adaptInterventions(
  raw: Wire.InterventionComparison, req: InterventionCompareRequest,
  routes: RouteComparison, snapshot: Wire.RiskSnapshot,
): InterventionComparison {
  const [first, second] = raw.results;
  const rankBasis = first.routeExposureReduction !== second.routeExposureReduction ? 'route_exposure_reduction'
    : first.segmentsMovedOutOfHigh !== second.segmentsMovedOutOfHigh ? 'segments_leaving_high' : 'drain_id';
  return {
    comparisonId: `${raw.baselineSnapshotId}:${raw.selectedRouteId}:drains`,
    baselineSnapshotId: raw.baselineSnapshotId,
    routeComparisonId: req.routeComparisonId,
    selectedRouteId: raw.selectedRouteId,
    selectedRouteBlocked: routes.candidates.find((candidate) => candidate.id === raw.selectedRouteId)?.blocked ?? false,
    drainIds: raw.results.map((result) => result.drainId),
    options: raw.results.map((result) => ({
      runId: result.id,
      rank: result.rank,
      drainId: result.drainId,
      drainLabel: result.label,
      affectedSegmentIds: result.affectedSegmentIds,
      routeExposureBefore: result.routeExposureBefore,
      routeExposureAfter: result.routeExposureAfter,
      exposureReduction: result.routeExposureReduction,
      segmentsLeavingHigh: result.segmentsMovedOutOfHigh,
      segmentChanges: result.segments.map((segment) => ({
        segmentId: segment.segmentId,
        beforeScore: segment.scoreBefore,
        afterScore: segment.scoreAfter,
        beforeClass: riskClass(segment.before),
        afterClass: riskClass(segment.after),
        drainageBefore: null,
        drainageAfter: null,
      })),
      hasEstimatedBenefit: result.routeExposureReduction > 0 || result.segmentsMovedOutOfHigh > 0,
    })),
    rankBasis,
    noEstimatedBenefit: !raw.hasEstimatedBenefit,
    baselineRouteOutcome: { outcome: routes.outcome, recommendedCandidateId: routes.recommendedCandidateId },
    assumptions: {
      drainageReduction: first.assumptions.drainageReduction,
      floor: 0,
      unchangedInputs: ['R', 'T', 'O'],
      statements: [first.assumptions.source, 'Only the modelled drainage input changes; rainfall, terrain, and observations stay fixed.', 'No real drain has been cleared. The baseline remains unchanged.'],
    },
    createdAt: null,
    modelVersion: snapshot.modelVersion,
  };
}
