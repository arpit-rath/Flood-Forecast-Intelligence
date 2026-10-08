import { expect, test } from 'vitest';
import type * as Wire from '../../../contracts/types';
import { RISK_LABEL } from '../lib/copy';
import { adaptSnapshot } from './wireAdapter';

test('missing local context stays Unknown and distinct from an observed zero', () => {
  const computedAt = '2026-10-08T12:00:00Z';
  const raw: Wire.RiskSnapshot = {
    id: 'fixture-v1:Scenario:unknown',
    bundleVersion: 'fixture-v1',
    mode: 'Scenario',
    computedAt,
    modelVersion: 'pilot-heuristic-v1',
    weather: { mode: 'Scenario', precipitationMmH: 9, validAt: computedAt, fetchedAt: computedAt, provider: 'Synthetic fixture' },
    weatherStale: false,
    segments: [{
      segmentId: 'H-0-0', score: null, class: 'Unknown', roadStatus: 'Unknown',
      coverage: 0.35, confidence: 'Low',
      features: { R: 0.3, T: null, D: null, O: null },
      missingFeatures: ['T', 'D', 'O'], evidenceIds: [], isClosed: false,
      computedAt, modelVersion: 'pilot-heuristic-v1',
    }],
  };

  const view = adaptSnapshot(raw);
  expect(view.mode).toBe('scenario');
  expect(view.segments[0].class).toBe('unknown');
  expect(RISK_LABEL[view.segments[0].class]).toBe('Unknown');
  expect(view.segments[0].score).toBeNull();
  expect(view.segments[0].features.T.value).toBeNull();
  expect(view.segments[0].features.R.value).toBe(0.3);
  expect(view.segments[0].lowConfidenceReasons).toContain('coverage_below_threshold');
});
