// Fixture authoring script for the frontend mock API.
//
// This is NOT the Varuna risk engine. It reproduces the pilot heuristic from
// Architecture.md §4–6 only so the mock JSON is internally consistent (scores,
// classes, route exposure and intervention deltas agree with each other).
// The browser bundle never runs this code; it only reads the JSON it writes.
// Replace the output with fixtures exported by the real engine when available.
//
// Usage: node scripts/build-fixtures.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'api', 'mock', 'fixtures');

// ---- Config mirrored from Architecture.md (pilot heuristic v1) ----
const MODEL_VERSION = 'pilot-heuristic-v1';
const WEIGHTS = { R: 0.35, T: 0.25, D: 0.2, O: 0.2 };
const BANDS = { watch: 0.35, high: 0.6 };
const LOW_CONFIDENCE_COVERAGE = 0.8;
const ROUTE_EXPOSURE_THRESHOLD = 0.1;
const DRAIN_REDUCTION = 0.5;
const BUNDLE_VERSION = 'dtu-pilot-fixture-2026-10-08';

// ---- Scenario ----
const SCENARIO = {
  id: 'scn-dtu-20mmh-v1',
  label: 'Scenario: 20 mm/h rainfall',
  precipitationMmH: 20,
  R: 0.6, // 20 mm/h normalised against the pilot scenario thresholds
  validAt: '2026-10-08T11:30:00Z',
  fetchedAt: '2026-10-08T11:30:00Z',
};

// ---- Illustrative grid geometry near DTU (not surveyed road geometry) ----
const LON0 = 77.1128;
const LAT0 = 28.7532;
const DX = 0.0016;
const DY = 0.0013;
const COLS = 6;
const ROWS = 5;
const ROW_NAMES = ['North Link Road', 'Hostel Road', 'Central Avenue', 'Library Lane', 'South Service Road'];
const COL_NAMES = ['West Gate Road', 'Lab Street', 'Admin Walk', 'Canal Street', 'Sports Lane', 'East Gate Road'];

const nodeId = (c, r) => `N-${c}${r}`;
const round6 = (v) => Math.round(v * 1e6) / 1e6;
const round3 = (v) => Math.round(v * 1e3) / 1e3;

function nodeCoord(c, r) {
  const jx = (((c * 7 + r * 13) % 5) - 2) * 0.00007;
  const jy = (((c * 11 + r * 3) % 5) - 2) * 0.00006;
  return [round6(LON0 + c * DX + jx), round6(LAT0 - r * DY + jy)];
}

function haversineM([lon1, lat1], [lon2, lat2]) {
  const R = 6371008.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Curated local context. Defaults apply unless overridden. null = not available.
const DEFAULT_CTX = { T: 0.1, D: 0.15 };
const NORTH_CTX = { T: 0.1, D: 0.15 };
const CTX = {
  // Central Avenue low point around Canal Street
  'S-H21': { T: 0.25, D: 0.2 },
  'S-H22': { T: 0.45, D: 0.35 },
  'S-H23': { T: 0.55, D: 0.5 },
  'S-V31': { T: 0.4, D: 0.3 },
  'S-V32': { T: 0.65, D: 0.5 },
  // Library Lane basin near Admin Walk
  'S-H31': { T: 0.45, D: 0.55 },
  'S-H32': { T: 0.6, D: 0.65 },
  'S-V22': { T: 0.4, D: 0.5 },
  'S-H33': { T: 0.5, D: 0.4 },
  // No drainage survey for the north-west corner: lower coverage
  'S-H00': { T: 0.1, D: null },
  'S-H01': { T: 0.1, D: null },
  'S-V00': { T: 0.1, D: null },
  // Terrain tile gap and no drainage survey on the east edge: Unknown
  'S-V51': { T: null, D: null },
  'S-V53': { T: null, D: null },
  'S-H04': { T: null, D: null },
};

const segments = [];
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS - 1; c++) {
    segments.push({ id: `S-H${r}${c}`, a: [c, r], b: [c + 1, r], name: `${ROW_NAMES[r]} · block ${c + 1}` });
  }
}
for (let c = 0; c < COLS; c++) {
  for (let r = 0; r < ROWS - 1; r++) {
    segments.push({ id: `S-V${c}${r}`, a: [c, r], b: [c, r + 1], name: `${COL_NAMES[c]} · block ${r + 1}` });
  }
}
// Drop a few links so the network is not a perfect grid (stays connected).
const DROPPED = new Set(['S-V10', 'S-V43', 'S-V13']);
const pilotSegments = segments
  .filter((s) => !DROPPED.has(s.id))
  .map((s) => {
    const coords = [nodeCoord(...s.a), nodeCoord(...s.b)];
    const lengthM = Math.round(haversineM(coords[0], coords[1]));
    const isNorth = s.id.startsWith('S-H0') || s.id.startsWith('S-H1') || /^S-V\d0$/.test(s.id);
    const ctx = CTX[s.id] ?? (isNorth ? NORTH_CTX : DEFAULT_CTX);
    return {
      ...s,
      coords,
      lengthM,
      fromNode: nodeId(...s.a),
      toNode: nodeId(...s.b),
      T: ctx.T,
      D: ctx.D,
    };
  });
const segById = Object.fromEntries(pilotSegments.map((s) => [s.id, s]));

// ---- Closures (operator-confirmed, fixture) ----
const CLOSURES = {
  'S-H33': {
    segmentId: 'S-H33',
    status: 'confirmed',
    reason: 'Construction works blocking the carriageway (fixture)',
    setBy: 'Responder (demo account)',
    setAt: '2026-10-08T09:15:00Z',
    expiresAt: '2026-10-08T18:00:00Z',
  },
};

// ---- Drains (illustrative choke points) ----
const DRAINS = [
  {
    id: 'D-01',
    label: 'Canal Street culvert inlet',
    node: [3, 2],
    affectedSegmentIds: ['S-H22', 'S-H23', 'S-V32'],
  },
  {
    id: 'D-02',
    label: 'Library Lane gully line',
    node: [2, 3],
    affectedSegmentIds: ['S-H31', 'S-H32', 'S-V22'],
  },
];

// ---- Scoring (Architecture §4) ----
function classify(score) {
  if (score === null) return 'unknown';
  if (score >= BANDS.high) return 'high';
  if (score >= BANDS.watch) return 'watch';
  return 'low';
}

function scoreSegment(seg, { O = null, D = seg.D } = {}) {
  const values = { R: SCENARIO.R, T: seg.T, D, O };
  let num = 0;
  let coverage = 0;
  for (const k of Object.keys(WEIGHTS)) {
    if (values[k] !== null && values[k] !== undefined) {
      num += WEIGHTS[k] * values[k];
      coverage += WEIGHTS[k];
    }
  }
  const hasContext = values.T !== null || values.D !== null;
  const score = hasContext ? round3(num / coverage) : null;
  return { values, score, coverage: round3(coverage) };
}

const FEATURE_SOURCES = {
  R: 'Scenario rainfall (scn-dtu-20mmh-v1)',
  T: 'Copernicus DEM relative low-point prior (fixture)',
  D: 'Curated drainage vulnerability (pilot assumption)',
  O: 'Accepted photo reports',
};

function riskEntry(seg, opts, computedAt, evidenceIds) {
  const { values, score, coverage } = scoreSegment(seg, opts);
  const cls = classify(score);
  const missing = Object.keys(WEIGHTS).filter((k) => values[k] === null);
  const lowConfidenceReasons = [];
  if (score !== null && coverage < LOW_CONFIDENCE_COVERAGE) lowConfidenceReasons.push('coverage_below_threshold');
  return {
    segmentId: seg.id,
    score,
    class: cls,
    coverage,
    lowConfidence: lowConfidenceReasons.length > 0,
    lowConfidenceReasons,
    features: Object.fromEntries(
      Object.keys(WEIGHTS).map((k) => [
        k,
        {
          value: values[k] === null ? null : round3(values[k]),
          weight: WEIGHTS[k],
          source: values[k] === null ? null : FEATURE_SOURCES[k],
          observedAt: k === 'O' && values[k] !== null ? '2026-10-08T11:24:00Z' : k === 'R' ? SCENARIO.validAt : null,
        },
      ]),
    ),
    missing,
    evidenceIds,
    closure: CLOSURES[seg.id] ?? null,
    computedAt,
    modelVersion: MODEL_VERSION,
  };
}

function buildSnapshot({ snapshotId, computedAt, acceptedObservations, acceptedReportIds, reportIdsBySegment }) {
  return {
    snapshotId,
    mode: 'scenario',
    computedAt,
    modelVersion: MODEL_VERSION,
    bundleVersion: BUNDLE_VERSION,
    stale: false,
    weather: {
      mode: 'scenario',
      precipitationMmH: SCENARIO.precipitationMmH,
      validAt: SCENARIO.validAt,
      fetchedAt: SCENARIO.fetchedAt,
      provider: 'Versioned scenario file',
      scenarioId: SCENARIO.id,
      scenarioLabel: SCENARIO.label,
      stale: false,
    },
    thresholds: { watch: BANDS.watch, high: BANDS.high, lowConfidenceCoverage: LOW_CONFIDENCE_COVERAGE },
    acceptedReportIds,
    segments: pilotSegments.map((s) =>
      riskEntry(s, { O: acceptedObservations[s.id] ?? null }, computedAt, reportIdsBySegment[s.id] ?? []),
    ),
  };
}

// Reports that sit on segments (pending/rejected ones are evidence history, not score input).
const REPORT_IDS_BY_SEGMENT = { 'S-H23': ['RPT-0001', 'RPT-0003'], 'S-H12': ['RPT-0002'] };

const snapshotBaseline = buildSnapshot({
  snapshotId: 'snap-scn-0001',
  computedAt: '2026-10-08T11:31:05Z',
  acceptedObservations: {},
  acceptedReportIds: [],
  reportIdsBySegment: REPORT_IDS_BY_SEGMENT,
});
const snapshotAfterReport = buildSnapshot({
  snapshotId: 'snap-scn-0002',
  computedAt: '2026-10-08T11:36:40Z',
  acceptedObservations: { 'S-H23': 1.0 },
  acceptedReportIds: ['RPT-0001'],
  reportIdsBySegment: REPORT_IDS_BY_SEGMENT,
});

// ---- Routes (Architecture §5), pilot replay geometry ----
const ROUTE_DEFS = [
  { id: 'rt-central', label: 'Via Central Avenue', segmentIds: ['S-H20', 'S-H21', 'S-H22', 'S-H23', 'S-H24'] },
  { id: 'rt-hostel', label: 'Via Hostel Road', segmentIds: ['S-V01', 'S-H10', 'S-H11', 'S-H12', 'S-H13', 'S-H14', 'S-V51'] },
  { id: 'rt-library', label: 'Via Library Lane', segmentIds: ['S-V02', 'S-H30', 'S-H31', 'S-H32', 'S-H33', 'S-H34', 'S-V52'] },
];
const SPEED_M_PER_MIN = { pedestrian: 80, car: 300 };
const CLASS_ORDER = ['low', 'watch', 'high'];

function routeGeometry(segmentIds, reverse) {
  // Chain segment endpoints into one line from origin to destination.
  const coords = [];
  let cursor = nodeCoord(0, 2);
  for (const id of segmentIds) {
    const s = segById[id];
    const [p, q] = s.coords;
    const forward = p[0] === cursor[0] && p[1] === cursor[1];
    const next = forward ? q : p;
    if (coords.length === 0) coords.push(cursor);
    coords.push(next);
    cursor = next;
  }
  return reverse ? [...coords].reverse() : coords;
}

function evaluateRoute(def, riskBySeg, travelMode, reverse) {
  const ids = reverse ? [...def.segmentIds].reverse() : def.segmentIds;
  let total = 0;
  let assessed = 0;
  let weighted = 0;
  let unknownLen = 0;
  let maxClass = null;
  const flagged = [];
  const blockedIds = [];
  for (const id of ids) {
    const seg = segById[id];
    const risk = riskBySeg[id];
    total += seg.lengthM;
    if (risk.closure) blockedIds.push(id);
    if (risk.score === null) {
      unknownLen += seg.lengthM;
    } else {
      assessed += seg.lengthM;
      weighted += seg.lengthM * risk.score;
      if (maxClass === null || CLASS_ORDER.indexOf(risk.class) > CLASS_ORDER.indexOf(maxClass)) maxClass = risk.class;
      if (risk.class === 'watch' || risk.class === 'high') flagged.push(id);
    }
  }
  const travelMinutes = Math.round((total / SPEED_M_PER_MIN[travelMode]) * 10) / 10;
  return {
    id: def.id,
    label: def.label,
    geometry: { type: 'LineString', coordinates: routeGeometry(def.segmentIds, reverse) },
    distanceM: total,
    travelMinutes,
    segmentIds: ids,
    exposure: assessed > 0 ? round3(weighted / assessed) : null,
    maxClass: maxClass ?? 'unknown',
    unknownShare: round3(unknownLen / total),
    flaggedSegmentIds: flagged,
    blocked: blockedIds.length > 0,
    blockedSegmentIds: blockedIds,
    unassessed: false,
    unmatchedShare: 0,
  };
}

function compareRoutes({ comparisonId, snapshot, travelMode, origin, destination, reverse, riskOverride }) {
  const riskBySeg = riskOverride ?? Object.fromEntries(snapshot.segments.map((s) => [s.segmentId, s]));
  const candidates = ROUTE_DEFS.map((d) => evaluateRoute(d, riskBySeg, travelMode, reverse));
  const fastest = [...candidates].sort((a, b) => a.travelMinutes - b.travelMinutes)[0];
  const eligible = candidates.filter((c) => !c.blocked && c.exposure !== null);
  let outcome;
  let recommended = null;
  if (eligible.length === 0 || eligible.every((c) => c.maxClass === 'high')) {
    outcome = 'no_lower_exposure';
  } else {
    const best = [...eligible].sort((a, b) => a.exposure - b.exposure || a.travelMinutes - b.travelMinutes)[0];
    const fastestEligible = !fastest.blocked && fastest.exposure !== null;
    if (fastestEligible && best.id !== fastest.id && round3(fastest.exposure - best.exposure) >= ROUTE_EXPOSURE_THRESHOLD) {
      outcome = 'lower_exposure_recommended';
      recommended = best;
    } else if (fastestEligible) {
      outcome = 'fastest_default';
      recommended = fastest;
    } else {
      outcome = 'lower_exposure_recommended';
      recommended = best;
    }
  }
  return {
    comparisonId,
    snapshotId: snapshot.snapshotId,
    origin,
    destination,
    travelMode,
    status: 'ok',
    outcome,
    recommendedCandidateId: recommended?.id ?? null,
    fastestCandidateId: fastest.id,
    exposureThreshold: ROUTE_EXPOSURE_THRESHOLD,
    candidates: candidates.map((c) => ({ ...c, isFastest: c.id === fastest.id })),
    computedAt: snapshot.computedAt,
    provenance: {
      provider: 'pilot_replay',
      label: 'Pilot replay route (deterministic fixture, not a live provider route)',
      snapshotId: snapshot.snapshotId,
      modelVersion: MODEL_VERSION,
    },
  };
}

const PLACES = [
  { id: 'west-gate', label: 'West Gate', point: nodeCoord(0, 2) },
  { id: 'east-gate', label: 'East Gate', point: nodeCoord(5, 2) },
  { id: 'hostel-block', label: 'Hostel block', point: nodeCoord(2, 1) },
  { id: 'library', label: 'Central Library', point: nodeCoord(3, 3) },
];

const routeComparisons = {};
for (const snap of [snapshotBaseline, snapshotAfterReport]) {
  for (const travelMode of ['pedestrian', 'car']) {
    for (const [o, d, reverse] of [
      ['west-gate', 'east-gate', false],
      ['east-gate', 'west-gate', true],
    ]) {
      const key = `${snap.snapshotId}|${o}|${d}|${travelMode}`;
      routeComparisons[key] = compareRoutes({
        comparisonId: `cmp-${snap.snapshotId.slice(-4)}-${o}-${d}-${travelMode}`,
        snapshot: snap,
        travelMode,
        origin: o,
        destination: d,
        reverse,
      });
    }
  }
}

// ---- Interventions (Architecture §6) ----
function simulateDrain(drain, snapshot) {
  const riskBySeg = Object.fromEntries(snapshot.segments.map((s) => [s.segmentId, s]));
  const after = { ...riskBySeg };
  const changes = [];
  for (const id of drain.affectedSegmentIds) {
    const seg = segById[id];
    const before = riskBySeg[id];
    const D = before.features.D.value === null ? null : Math.max(0, before.features.D.value - DRAIN_REDUCTION);
    const O = before.features.O.value;
    const next = riskEntry(seg, { O, D }, snapshot.computedAt, before.evidenceIds);
    after[id] = next;
    changes.push({
      segmentId: id,
      beforeScore: before.score,
      afterScore: next.score,
      beforeClass: before.class,
      afterClass: next.class,
      drainageBefore: before.features.D.value,
      drainageAfter: next.features.D.value,
    });
  }
  return { after, changes };
}

const interventionComparisons = {};
for (const snap of [snapshotBaseline, snapshotAfterReport]) {
  for (const travelMode of ['pedestrian', 'car']) {
    for (const [o, d, reverse] of [
      ['west-gate', 'east-gate', false],
      ['east-gate', 'west-gate', true],
    ]) {
      const baseCmp = routeComparisons[`${snap.snapshotId}|${o}|${d}|${travelMode}`];
      for (const route of baseCmp.candidates) {
        const options = DRAINS.map((drain) => {
          const { after, changes } = simulateDrain(drain, snap);
          const afterCmp = compareRoutes({
            comparisonId: `${baseCmp.comparisonId}-sim-${drain.id}`,
            snapshot: snap,
            travelMode,
            origin: o,
            destination: d,
            reverse,
            riskOverride: after,
          });
          const beforeRoute = baseCmp.candidates.find((c) => c.id === route.id);
          const afterRoute = afterCmp.candidates.find((c) => c.id === route.id);
          const exposureReduction =
            beforeRoute.exposure === null || afterRoute.exposure === null
              ? 0
              : round3(beforeRoute.exposure - afterRoute.exposure);
          const segmentsLeavingHigh = changes.filter((ch) => ch.beforeClass === 'high' && ch.afterClass !== 'high').length;
          const affectedRouteCount = baseCmp.candidates.filter((c) => {
            const a = afterCmp.candidates.find((x) => x.id === c.id);
            return c.exposure !== a.exposure;
          }).length;
          return {
            runId: `run-${snap.snapshotId.slice(-4)}-${route.id}-${travelMode}-${o}-${drain.id}`,
            drainId: drain.id,
            drainLabel: drain.label,
            affectedSegmentIds: drain.affectedSegmentIds,
            routeExposureBefore: beforeRoute.exposure,
            routeExposureAfter: afterRoute.exposure,
            exposureReduction,
            segmentsLeavingHigh,
            affectedRouteCount,
            segmentChanges: changes,
            routeOutcomeAfter: {
              outcome: afterCmp.outcome,
              recommendedCandidateId: afterCmp.recommendedCandidateId,
              candidates: afterCmp.candidates.map((c) => ({ id: c.id, exposure: c.exposure, blocked: c.blocked })),
            },
            hasEstimatedBenefit: exposureReduction > 0 || segmentsLeavingHigh > 0,
          };
        });
        options.sort(
          (a, b) =>
            b.exposureReduction - a.exposureReduction ||
            b.segmentsLeavingHigh - a.segmentsLeavingHigh ||
            a.drainId.localeCompare(b.drainId),
        );
        const ranked = options.map((opt, i) => ({ ...opt, rank: i + 1 }));
        const [first, second] = ranked;
        let rankBasis;
        if (first.exposureReduction !== second.exposureReduction) rankBasis = 'route_exposure_reduction';
        else if (first.segmentsLeavingHigh !== second.segmentsLeavingHigh) rankBasis = 'segments_leaving_high';
        else rankBasis = 'drain_id';
        const key = `${snap.snapshotId}|${baseCmp.comparisonId}|${route.id}`;
        interventionComparisons[key] = {
          comparisonId: `ivc-${snap.snapshotId.slice(-4)}-${route.id}-${travelMode}-${o}`,
          baselineSnapshotId: snap.snapshotId,
          routeComparisonId: baseCmp.comparisonId,
          selectedRouteId: route.id,
          selectedRouteBlocked: route.blocked,
          drainIds: DRAINS.map((d) => d.id),
          options: ranked,
          rankBasis,
          noEstimatedBenefit: ranked.every((r) => !r.hasEstimatedBenefit),
          baselineRouteOutcome: {
            outcome: baseCmp.outcome,
            recommendedCandidateId: baseCmp.recommendedCandidateId,
          },
          assumptions: {
            drainageReduction: DRAIN_REDUCTION,
            floor: 0,
            unchangedInputs: ['R', 'T', 'O'],
            statements: [
              'Clearing a modelled drain lowers the curated drainage-vulnerability input by 0.5 (floored at zero) on its listed segments only.',
              'Rainfall, terrain and accepted report evidence are held at baseline values.',
              'Drain locations are illustrative choke points, not a verified drainage network.',
              'This is a comparative what-if estimate, not a physical flood simulation or a time to recovery.',
            ],
          },
          createdAt: snap.computedAt,
          modelVersion: MODEL_VERSION,
        };
      }
    }
  }
}

// ---- Pilot ----
const pilot = {
  pilotId: 'dtu-pilot',
  name: 'DTU and approach roads (pilot)',
  bundleVersion: BUNDLE_VERSION,
  preparedAt: '2026-10-08T06:00:00Z',
  mapUpdatedAt: '2026-10-08T06:00:00Z',
  geometryNote:
    'Fixture geometry: an illustrative street grid near DTU used for interface development. It is not surveyed road geometry.',
  bounds: [round6(LON0 - DX), round6(LAT0 - (ROWS - 1) * DY - DY), round6(LON0 + COLS * DX), round6(LAT0 + DY)],
  center: nodeCoord(2.5, 2),
  segments: {
    type: 'FeatureCollection',
    features: pilotSegments.map((s) => ({
      type: 'Feature',
      id: s.id,
      geometry: { type: 'LineString', coordinates: s.coords },
      properties: {
        id: s.id,
        name: s.name,
        fromNode: s.fromNode,
        toNode: s.toNode,
        lengthM: s.lengthM,
        terrainPrior: s.T,
        drainageVulnerability: s.D,
        source: 'Fixture grid (illustrative)',
        bundleVersion: BUNDLE_VERSION,
      },
    })),
  },
  drains: {
    type: 'FeatureCollection',
    features: DRAINS.map((d) => ({
      type: 'Feature',
      id: d.id,
      geometry: { type: 'Point', coordinates: nodeCoord(...d.node) },
      properties: {
        id: d.id,
        label: d.label,
        affectedSegmentIds: d.affectedSegmentIds,
        illustrative: true,
      },
    })),
  },
  places: PLACES,
  travelModes: ['pedestrian', 'car'],
  sources: [
    {
      id: 'geometry',
      name: 'Fixture street grid',
      licence: 'Project fixture',
      note: 'Replace with the checked OpenStreetMap extract (© OpenStreetMap contributors, ODbL).',
    },
    {
      id: 'terrain',
      name: 'Copernicus DEM GLO-30 (fixture values)',
      licence: 'Copernicus DEM licence',
      url: 'https://registry.opendata.aws/copernicus-dem/',
      note: '30 m surface model; cannot resolve kerbs, drains or underpasses.',
    },
    { id: 'rain', name: 'Scenario rainfall file', licence: 'Project fixture', note: 'Synthetic, reproducible demo rainfall.' },
    { id: 'drains', name: 'Modelled drain nodes', licence: 'Project fixture', note: 'Illustrative choke points.' },
  ],
};

// ---- Seeded reports ----
const reports = [
  {
    id: 'RPT-0001',
    segmentId: 'S-H23',
    point: [round6((segById['S-H23'].coords[0][0] + segById['S-H23'].coords[1][0]) / 2), round6((segById['S-H23'].coords[0][1] + segById['S-H23'].coords[1][1]) / 2)],
    createdAt: '2026-10-08T11:24:00Z',
    capturedAt: '2026-10-08T11:22:00Z',
    imageKey: 'fixtures/rpt-0001.jpg',
    imageUrl: null,
    note: 'Water across the road near the canal corner.',
    reviewStatus: 'pending_review',
    analysis: { status: 'complete', provider: 'fixture', model: null, completedAt: '2026-10-08T11:24:09Z', failureReason: null },
    observations: {
      visible_water: 'clear',
      drain_state: 'not_visible',
      visible_hazards: ['debris'],
      access_concern: 'possible',
      confidence: 0.72,
      evidence_summary: 'Standing water covers most of the visible carriageway; floating debris near the kerb.',
      needs_human_review: true,
    },
    modelConfidence: 0.72,
    source: 'fixture',
    review: null,
  },
  {
    id: 'RPT-0002',
    segmentId: 'S-H12',
    point: [round6((segById['S-H12'].coords[0][0] + segById['S-H12'].coords[1][0]) / 2), round6((segById['S-H12'].coords[0][1] + segById['S-H12'].coords[1][1]) / 2)],
    createdAt: '2026-10-08T11:05:00Z',
    capturedAt: null,
    imageKey: 'fixtures/rpt-0002.jpg',
    imageUrl: null,
    note: 'Road looks wet outside the hostel.',
    reviewStatus: 'rejected',
    analysis: { status: 'complete', provider: 'fixture', model: null, completedAt: '2026-10-08T11:05:11Z', failureReason: null },
    observations: {
      visible_water: 'uncertain',
      drain_state: 'not_visible',
      visible_hazards: [],
      access_concern: 'none',
      confidence: 0.31,
      evidence_summary: 'Dark, reflective pavement; standing water cannot be confirmed.',
      needs_human_review: true,
    },
    modelConfidence: 0.31,
    source: 'fixture',
    review: { decision: 'reject', reviewedAt: '2026-10-08T11:12:00Z', reviewer: 'Responder (demo account)' },
  },
  {
    id: 'RPT-0003',
    segmentId: 'S-H23',
    point: [round6(segById['S-H23'].coords[1][0] - 0.0003), round6(segById['S-H23'].coords[1][1])],
    createdAt: '2026-10-08T11:27:00Z',
    capturedAt: null,
    imageKey: 'fixtures/rpt-0003.jpg',
    imageUrl: null,
    note: '',
    reviewStatus: 'needs_manual_review',
    analysis: {
      status: 'failed',
      provider: 'fixture',
      model: null,
      completedAt: '2026-10-08T11:27:30Z',
      failureReason: 'Image analysis timed out',
    },
    observations: null,
    modelConfidence: null,
    source: 'fixture',
    review: null,
  },
];

// ---- Write ----
mkdirSync(OUT, { recursive: true });
const write = (name, data) => writeFileSync(join(OUT, name), JSON.stringify(data, null, 2) + '\n');
write('pilot.json', pilot);
write('snapshot-baseline.json', snapshotBaseline);
write('snapshot-after-report.json', snapshotAfterReport);
write('route-comparisons.json', routeComparisons);
write('intervention-comparisons.json', interventionComparisons);
write('reports.json', reports);

// ---- Summary for fixture tuning ----
for (const snap of [snapshotBaseline, snapshotAfterReport]) {
  const cmp = routeComparisons[`${snap.snapshotId}|west-gate|east-gate|pedestrian`];
  console.log(`\n${snap.snapshotId}: outcome=${cmp.outcome} recommended=${cmp.recommendedCandidateId}`);
  for (const c of cmp.candidates) {
    console.log(`  ${c.id} exposure=${c.exposure} min=${c.travelMinutes} max=${c.maxClass} unknown=${c.unknownShare} blocked=${c.blocked}`);
  }
  const counts = snap.segments.reduce((acc, s) => ({ ...acc, [s.class]: (acc[s.class] ?? 0) + 1 }), {});
  console.log('  classes', counts, 'segments', snap.segments.length);
  const ivc = interventionComparisons[`${snap.snapshotId}|${cmp.comparisonId}|rt-central`];
  for (const o of ivc.options) {
    console.log(`  #${o.rank} ${o.drainId} reduction=${o.exposureReduction} leavingHigh=${o.segmentsLeavingHigh} after=${o.routeOutcomeAfter.outcome}/${o.routeOutcomeAfter.recommendedCandidateId}`);
  }
}
