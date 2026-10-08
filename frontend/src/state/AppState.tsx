import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { VarunaApi } from '../api/client';
import {
  ApiError,
  type InterventionComparison,
  type PilotResponse,
  type Report,
  type ReviewResponse,
  type RiskSnapshotResponse,
  type RouteComparison,
  type SegmentProperties,
  type SegmentRisk,
  type TravelMode,
  type WeatherMode,
} from '../api/types';
import { newIdempotencyKey } from '../lib/hooks';

export type Async<T> =
  | { status: 'idle' }
  | { status: 'loading'; data?: T }
  | { status: 'ready'; data: T }
  | { status: 'error'; error: ApiError; data?: T };

export interface RouteQuery {
  originPlaceId: string;
  destinationPlaceId: string;
  travelMode: TravelMode;
}

export interface SimulationPreview {
  comparisonId: string;
  drainId: string;
}

interface AppStateValue {
  api: VarunaApi;
  pilot: Async<PilotResponse>;
  segmentsById: Map<string, SegmentProperties>;
  mode: WeatherMode;
  setMode: (mode: WeatherMode) => void;
  snapshot: Async<RiskSnapshotResponse>;
  /** Snapshot before the most recent recalculation, for "what changed" copy. */
  previousSnapshot: RiskSnapshotResponse | null;
  riskById: Map<string, SegmentRisk>;
  refreshSnapshot: () => void;
  selectedSegmentId: string | null;
  selectSegment: (id: string | null) => void;
  routeQuery: RouteQuery | null;
  routes: Async<RouteComparison>;
  /** Route comparison only when it belongs to the snapshot on screen. */
  currentRoutes: RouteComparison | null;
  compareRoutes: (query: RouteQuery) => void;
  selectedRouteId: string | null;
  setSelectedRouteId: (id: string) => void;
  reports: Async<Report[]>;
  refreshReports: () => Promise<void>;
  upsertReport: (report: Report) => void;
  reviewReport: (id: string, decision: 'accept' | 'reject') => Promise<ReviewResponse>;
  intervention: Async<InterventionComparison>;
  interventionIsStale: boolean;
  runIntervention: (routeId: string) => void;
  simulationPreview: SimulationPreview | null;
  setSimulationPreview: (preview: SimulationPreview | null) => void;
  announcement: string;
  announce: (message: string) => void;
}

const AppStateContext = createContext<AppStateValue | null>(null);

function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  return new ApiError({
    code: 'UNEXPECTED',
    message: err instanceof Error ? err.message : 'Something went wrong.',
    retryable: true,
    requestId: '',
  });
}

export function AppStateProvider({ api, children }: { api: VarunaApi; children: ReactNode }) {
  const [pilot, setPilot] = useState<Async<PilotResponse>>({ status: 'loading' });
  const [mode, setModeState] = useState<WeatherMode>('scenario');
  const [snapshot, setSnapshot] = useState<Async<RiskSnapshotResponse>>({ status: 'loading' });
  const [previousSnapshot, setPreviousSnapshot] = useState<RiskSnapshotResponse | null>(null);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [routeQuery, setRouteQuery] = useState<RouteQuery | null>(null);
  const [routes, setRoutes] = useState<Async<RouteComparison>>({ status: 'idle' });
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [reports, setReports] = useState<Async<Report[]>>({ status: 'loading' });
  const [intervention, setIntervention] = useState<Async<InterventionComparison>>({ status: 'idle' });
  const [simulationPreview, setSimulationPreview] = useState<SimulationPreview | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const snapshotRequest = useRef(0);

  const announce = useCallback((message: string) => {
    // Clear first so repeating the same message is still announced.
    setAnnouncement('');
    window.setTimeout(() => setAnnouncement(message), 50);
  }, []);

  const loadSnapshot = useCallback(
    async (nextMode: WeatherMode, { announceResult = false } = {}) => {
      const request = ++snapshotRequest.current;
      setSnapshot((prev) => ({ status: 'loading', data: prev.status === 'ready' && prev.data.mode === nextMode ? prev.data : undefined }));
      try {
        const data = await api.getCurrentSnapshot(nextMode);
        if (request !== snapshotRequest.current) return;
        setSnapshot((prev) => {
          const old = 'data' in prev ? prev.data : undefined;
          if (old && old.snapshotId !== data.snapshotId && old.mode === data.mode) setPreviousSnapshot(old);
          return { status: 'ready', data };
        });
        if (announceResult) announce('Risk estimate updated.');
      } catch (err) {
        if (request !== snapshotRequest.current) return;
        const error = toApiError(err);
        // Never keep data from another mode on screen as if it were current.
        setSnapshot({ status: 'error', error });
        announce(error.message);
      }
    },
    [api, announce],
  );

  const refreshReports = useCallback(async () => {
    try {
      const data = await api.listReports();
      setReports({ status: 'ready', data });
    } catch (err) {
      setReports((prev) => ({ status: 'error', error: toApiError(err), data: 'data' in prev ? prev.data : undefined }));
    }
  }, [api]);

  useEffect(() => {
    api
      .getPilot()
      .then((data) => setPilot({ status: 'ready', data }))
      .catch((err) => setPilot({ status: 'error', error: toApiError(err) }));
    void loadSnapshot('scenario');
    void refreshReports();
  }, [api, loadSnapshot, refreshReports]);

  const setMode = useCallback(
    (next: WeatherMode) => {
      setModeState(next);
      setPreviousSnapshot(null);
      setSimulationPreview(null);
      void loadSnapshot(next, { announceResult: true });
    },
    [loadSnapshot],
  );

  const refreshSnapshot = useCallback(() => void loadSnapshot(mode, { announceResult: true }), [loadSnapshot, mode]);

  const currentSnapshotId = snapshot.status === 'ready' ? snapshot.data.snapshotId : null;

  const compareRoutes = useCallback(
    async (query: RouteQuery) => {
      setRouteQuery(query);
      if (!currentSnapshotId) return;
      setRoutes((prev) => ({ status: 'loading', data: 'data' in prev ? prev.data : undefined }));
      try {
        const data = await api.compareRoutes({ ...query, snapshotId: currentSnapshotId });
        setRoutes({ status: 'ready', data });
        setSelectedRouteId(data.recommendedCandidateId ?? data.fastestCandidateId);
        const rec = data.candidates.find((c) => c.id === data.recommendedCandidateId);
        announce(
          data.outcome === 'lower_exposure_recommended' && rec
            ? `Route comparison updated. Recommended: ${rec.label}, lower estimated exposure.`
            : data.outcome === 'no_lower_exposure'
              ? 'Route comparison updated. No lower-exposure route found.'
              : 'Route comparison updated. Fastest route shown as default.',
        );
      } catch (err) {
        const error = toApiError(err);
        setRoutes({ status: 'error', error });
        announce(`Route comparison unavailable. ${error.message}`);
      }
    },
    [api, announce, currentSnapshotId],
  );

  // Default comparison between the first two pilot places once data is ready.
  useEffect(() => {
    if (pilot.status !== 'ready' || !currentSnapshotId || routeQuery) return;
    const [origin, destination] = pilot.data.places;
    if (!origin || !destination) return;
    void compareRoutes({ originPlaceId: origin.id, destinationPlaceId: destination.id, travelMode: pilot.data.travelModes[0] ?? 'pedestrian' });
  }, [pilot, currentSnapshotId, routeQuery, compareRoutes]);

  // Re-run the comparison when the snapshot changes (e.g. after a review).
  useEffect(() => {
    if (!routeQuery || !currentSnapshotId) return;
    if (routes.status === 'loading') return;
    const shownFor = 'data' in routes && routes.data ? routes.data.snapshotId : null;
    if (shownFor !== currentSnapshotId && routes.status !== 'error') void compareRoutes(routeQuery);
  }, [currentSnapshotId, routeQuery, routes, compareRoutes]);

  const currentRoutes =
    routes.status === 'ready' && routes.data.snapshotId === currentSnapshotId ? routes.data : null;

  const runIntervention = useCallback(
    async (routeId: string) => {
      if (!currentSnapshotId || !currentRoutes) return;
      const pilotDrains = pilot.status === 'ready' ? pilot.data.drains.features.map((f) => f.id) : [];
      if (pilotDrains.length < 2) return;
      setIntervention({ status: 'loading' });
      setSimulationPreview(null);
      try {
        const data = await api.compareInterventions({
          drainIds: [pilotDrains[0], pilotDrains[1]],
          baselineSnapshotId: currentSnapshotId,
          routeComparisonId: currentRoutes.comparisonId,
          selectedRouteId: routeId,
          idempotencyKey: newIdempotencyKey(),
        });
        setIntervention({ status: 'ready', data });
        const first = data.options[0];
        announce(
          data.noEstimatedBenefit
            ? 'Simulation complete. Neither drain action has an estimated benefit.'
            : `Simulation complete. ${first.drainId} ranks first.`,
        );
      } catch (err) {
        const error = toApiError(err);
        setIntervention({ status: 'error', error });
        announce(`Simulation failed. ${error.message}`);
      }
    },
    [api, announce, currentRoutes, currentSnapshotId, pilot],
  );

  const interventionIsStale =
    intervention.status === 'ready' && intervention.data.baselineSnapshotId !== currentSnapshotId;

  const upsertReport = useCallback((report: Report) => {
    setReports((prev) => {
      const list = 'data' in prev && prev.data ? prev.data : [];
      const next = [report, ...list.filter((r) => r.id !== report.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { status: 'ready', data: next };
    });
  }, []);

  const reviewReport = useCallback(
    async (id: string, decision: 'accept' | 'reject') => {
      const res = await api.reviewReport(id, { decision });
      upsertReport(res.report);
      if (res.snapshotId && res.snapshotId !== currentSnapshotId) {
        await loadSnapshot(mode, { announceResult: false });
        announce(`Report ${decision === 'accept' ? 'accepted' : 'rejected'}. Risk estimate recalculated.`);
      } else {
        announce(`Report ${decision === 'accept' ? 'accepted' : 'rejected'}.`);
      }
      return res;
    },
    [api, announce, currentSnapshotId, loadSnapshot, mode, upsertReport],
  );

  const segmentsById = useMemo(() => {
    const map = new Map<string, SegmentProperties>();
    if (pilot.status === 'ready') for (const f of pilot.data.segments.features) map.set(f.id, f.properties);
    return map;
  }, [pilot]);

  const riskById = useMemo(() => {
    const map = new Map<string, SegmentRisk>();
    if (snapshot.status === 'ready') for (const s of snapshot.data.segments) map.set(s.segmentId, s);
    return map;
  }, [snapshot]);

  const value: AppStateValue = {
    api,
    pilot,
    segmentsById,
    mode,
    setMode,
    snapshot,
    previousSnapshot,
    riskById,
    refreshSnapshot,
    selectedSegmentId,
    selectSegment: setSelectedSegmentId,
    routeQuery,
    routes,
    currentRoutes,
    compareRoutes: (q) => void compareRoutes(q),
    selectedRouteId,
    setSelectedRouteId,
    reports,
    refreshReports,
    upsertReport,
    reviewReport,
    intervention,
    interventionIsStale,
    runIntervention: (id) => void runIntervention(id),
    simulationPreview,
    setSimulationPreview,
    announcement,
    announce,
  };

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used inside AppStateProvider');
  return ctx;
}
