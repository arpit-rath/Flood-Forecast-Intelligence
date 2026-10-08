import { createHttpApi } from './http';
import { createMockApi } from './mock/mockApi';
import type {
  CreateReportRequest,
  InterventionCompareRequest,
  InterventionComparison,
  PilotResponse,
  Report,
  ReviewRequest,
  ReviewResponse,
  RiskSnapshotResponse,
  RouteCompareRequest,
  RouteComparison,
  UploadUrlRequest,
  UploadUrlResponse,
  WeatherMode,
} from './types';

export interface VarunaApi {
  /** 'mock' responses come from local fixtures, never from AWS. */
  readonly kind: 'mock' | 'http';
  getPilot(): Promise<PilotResponse>;
  getCurrentSnapshot(mode: WeatherMode): Promise<RiskSnapshotResponse>;
  listReports(): Promise<Report[]>;
  getReport(id: string): Promise<Report>;
  requestUploadUrl(req: UploadUrlRequest): Promise<UploadUrlResponse>;
  uploadImage(upload: UploadUrlResponse, file: File): Promise<void>;
  createReport(req: CreateReportRequest): Promise<Report>;
  reviewReport(id: string, req: ReviewRequest): Promise<ReviewResponse>;
  compareRoutes(req: RouteCompareRequest): Promise<RouteComparison>;
  compareInterventions(req: InterventionCompareRequest): Promise<InterventionComparison>;
}

export function createApi(): VarunaApi {
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;
  const useMocks = (import.meta.env.VITE_USE_MOCKS as string | undefined) !== 'false';
  if (!useMocks && baseUrl) return createHttpApi(baseUrl);
  return createMockApi();
}
