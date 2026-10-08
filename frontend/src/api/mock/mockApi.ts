import type { VarunaApi } from '../client';
import {
  ApiError,
  type InterventionComparison,
  type Observation,
  type PilotResponse,
  type Report,
  type RiskSnapshotResponse,
  type RouteComparison,
} from '../types';
import interventionData from './fixtures/intervention-comparisons.json';
import pilotData from './fixtures/pilot.json';
import reportData from './fixtures/reports.json';
import routeData from './fixtures/route-comparisons.json';
import snapshotAfterData from './fixtures/snapshot-after-report.json';
import snapshotBaselineData from './fixtures/snapshot-baseline.json';

// In-browser mock of the Varuna API. Every value comes from the generated
// fixtures in ./fixtures; nothing here scores risk or ranks routes. Mock
// output is tagged (analysis.provider = 'fixture', provenance = pilot_replay)
// so the UI can label it.

const pilot = pilotData as unknown as PilotResponse;
const baseline = snapshotBaselineData as unknown as RiskSnapshotResponse;
const afterReport = snapshotAfterData as unknown as RiskSnapshotResponse;
const routes = routeData as unknown as Record<string, RouteComparison>;
const interventions = interventionData as unknown as Record<string, InterventionComparison>;
const seededReports = reportData as unknown as Report[];

/** The fixture only has a recalculated snapshot for evidence on this segment. */
const RECALCULATED_SEGMENT = 'S-H23';

const FIXTURE_OBSERVATION: Observation = {
  visible_water: 'clear',
  drain_state: 'uncertain',
  visible_hazards: [],
  access_concern: 'possible',
  confidence: 0.64,
  evidence_summary: 'Fixture response: standing water appears across part of the road surface.',
  needs_human_review: true,
};

export interface MockApiOptions {
  /** Artificial latency in ms; 0 in tests. */
  latencyMs?: number;
  /** How long the fake image analysis stays pending. */
  analysisMs?: number;
  now?: () => Date;
}

let requestCounter = 0;
const requestId = () => `mock-${(++requestCounter).toString().padStart(4, '0')}`;

export function createMockApi(options: MockApiOptions = {}): VarunaApi {
  const latencyMs = options.latencyMs ?? 350;
  const analysisMs = options.analysisMs ?? 2500;
  const now = options.now ?? (() => new Date());

  const reports = new Map<string, Report>(structuredClone(seededReports).map((r) => [r.id, r]));
  const previews = new Map<string, string>();
  const analysisDueAt = new Map<string, { at: number; fail: boolean }>();
  let current: RiskSnapshotResponse = structuredClone(baseline);

  const delay = <T>(value: T): Promise<T> =>
    new Promise((resolve) => setTimeout(() => resolve(structuredClone(value)), latencyMs));
  const fail = (code: string, message: string, retryable: boolean): Promise<never> =>
    new Promise((_, reject) =>
      setTimeout(() => reject(new ApiError({ code, message, retryable, requestId: requestId() })), latencyMs),
    );

  function settleAnalysis(report: Report): Report {
    const due = analysisDueAt.get(report.id);
    if (!due || report.reviewStatus !== 'analysis_pending' || now().getTime() < due.at) return report;
    analysisDueAt.delete(report.id);
    const completedAt = now().toISOString();
    const next: Report = due.fail
      ? {
          ...report,
          reviewStatus: 'needs_manual_review',
          analysis: { ...report.analysis, status: 'failed', completedAt, failureReason: 'Image analysis timed out' },
        }
      : {
          ...report,
          reviewStatus: 'pending_review',
          observations: FIXTURE_OBSERVATION,
          modelConfidence: FIXTURE_OBSERVATION.confidence,
          analysis: { ...report.analysis, status: 'complete', completedAt },
        };
    reports.set(next.id, next);
    return next;
  }

  function withRecalculatedTime(snapshot: RiskSnapshotResponse): RiskSnapshotResponse {
    const computedAt = now().toISOString();
    return {
      ...structuredClone(snapshot),
      computedAt,
      segments: snapshot.segments.map((s) => ({ ...s, computedAt })),
    };
  }

  return {
    kind: 'mock',

    getPilot: () => delay(pilot),

    getCurrentSnapshot(mode) {
      if (mode === 'live') {
        return fail(
          'LIVE_WEATHER_UNAVAILABLE',
          'Live weather is not connected in the local mock. No live forecast is shown as current.',
          true,
        );
      }
      return delay(current);
    },

    listReports: () => delay([...reports.values()].map(settleAnalysis).sort((a, b) => b.createdAt.localeCompare(a.createdAt))),

    getReport(id) {
      const report = reports.get(id);
      if (!report) return fail('REPORT_NOT_FOUND', `Report ${id} was not found.`, false);
      return delay(settleAnalysis(report));
    },

    requestUploadUrl(req) {
      const maxBytes = 8 * 1024 * 1024;
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(req.contentType)) {
        return fail('UNSUPPORTED_FILE_TYPE', 'Use a JPEG, PNG or WebP photo.', false);
      }
      if (req.sizeBytes > maxBytes) return fail('FILE_TOO_LARGE', 'Photos must be 8 MB or smaller.', false);
      const imageKey = `mock-uploads/${crypto.randomUUID()}`;
      return delay({
        uploadUrl: `mock://upload/${imageKey}`,
        imageKey,
        expiresAt: new Date(now().getTime() + 5 * 60_000).toISOString(),
        maxBytes,
      });
    },

    async uploadImage(upload, file) {
      // Kept in memory as an object URL; nothing leaves the browser.
      previews.set(upload.imageKey, URL.createObjectURL(file));
      if (file.name.toLowerCase().includes('fail')) analysisDueAt.set(upload.imageKey, { at: 0, fail: true });
      await delay(null);
    },

    createReport(req) {
      if (!pilot.segments.features.some((f) => f.id === req.segmentId)) {
        return fail('OUTSIDE_PILOT', 'Choose a location on a mapped pilot road.', false);
      }
      const existing = [...reports.values()].find((r) => r.imageKey === req.imageKey);
      if (existing) return delay(existing);
      const id = `RPT-${(reports.size + 1).toString().padStart(4, '0')}`;
      const createdAt = now().toISOString();
      const report: Report = {
        id,
        segmentId: req.segmentId,
        point: req.point,
        createdAt,
        capturedAt: req.capturedAt,
        imageKey: req.imageKey,
        // Responders always see the private preview; consent governs public display only.
        imageUrl: previews.get(req.imageKey) ?? null,
        note: req.note.slice(0, 280),
        reviewStatus: 'analysis_pending',
        analysis: { status: 'pending', provider: 'fixture', model: null, completedAt: null, failureReason: null },
        observations: null,
        modelConfidence: null,
        source: 'resident_upload',
        review: null,
      };
      const forcedFail = analysisDueAt.get(req.imageKey)?.fail ?? false;
      analysisDueAt.delete(req.imageKey);
      analysisDueAt.set(id, { at: now().getTime() + analysisMs, fail: forcedFail });
      reports.set(id, report);
      return delay(report);
    },

    reviewReport(id, req) {
      const report = reports.get(id);
      if (!report) return fail('REPORT_NOT_FOUND', `Report ${id} was not found.`, false);
      const settled = settleAnalysis(report);
      if (settled.reviewStatus === 'analysis_pending') {
        return fail('ANALYSIS_IN_PROGRESS', 'Wait for image analysis to finish or time out before reviewing.', true);
      }
      const reviewed: Report = {
        ...settled,
        reviewStatus: req.decision === 'accept' ? 'accepted' : 'rejected',
        review: { decision: req.decision, reviewedAt: now().toISOString(), reviewer: 'Responder (demo account)' },
      };
      reports.set(id, reviewed);

      if (req.decision === 'reject') {
        return delay({ report: reviewed, snapshotId: null, note: 'Rejected evidence does not enter the score.' });
      }
      if (reviewed.segmentId === RECALCULATED_SEGMENT) {
        const alreadyApplied = current.snapshotId === afterReport.snapshotId;
        current = alreadyApplied ? current : withRecalculatedTime(afterReport);
        current = {
          ...current,
          acceptedReportIds: [...new Set([...current.acceptedReportIds, reviewed.id])],
          segments: current.segments.map((s) =>
            s.segmentId === reviewed.segmentId ? { ...s, evidenceIds: [...new Set([...s.evidenceIds, reviewed.id])] } : s,
          ),
        };
        return delay({
          report: reviewed,
          snapshotId: current.snapshotId,
          note: alreadyApplied ? 'Observation evidence for this segment was already at its maximum.' : undefined,
        });
      }
      return delay({
        report: reviewed,
        snapshotId: null,
        note: `Mock limitation: the fixture has no recalculated snapshot for ${reviewed.segmentId}. The deployed API recalculates here.`,
      });
    },

    compareRoutes(req) {
      const found = routes[`${req.snapshotId}|${req.originPlaceId}|${req.destinationPlaceId}|${req.travelMode}`];
      if (!found) {
        return fail(
          'ROUTES_UNAVAILABLE',
          'No route alternatives are available for this origin and destination.',
          false,
        );
      }
      return delay({ ...found, computedAt: current.snapshotId === req.snapshotId ? current.computedAt : found.computedAt });
    },

    compareInterventions(req) {
      const found = interventions[`${req.baselineSnapshotId}|${req.routeComparisonId}|${req.selectedRouteId}`];
      if (!found) {
        return fail('INTERVENTION_UNAVAILABLE', 'No simulation is available for this route and baseline.', false);
      }
      return delay(found);
    },
  };
}
