import type { RouteComparison } from '../api/types';
import { formatExposure, formatExtraMinutes, pluralize } from './format';

/** Headline and explanation for a route comparison outcome (Design-System.md §7). */
export function outcomeSummary(data: RouteComparison): { title: string; body: string } {
  const fastest = data.candidates.find((c) => c.id === data.fastestCandidateId);
  const rec = data.candidates.find((c) => c.id === data.recommendedCandidateId);
  switch (data.outcome) {
    case 'lower_exposure_recommended':
      if (!rec || !fastest) break;
      return {
        title: `Lower estimated exposure · ${formatExtraMinutes(rec.travelMinutes - fastest.travelMinutes)}`,
        body:
          rec.id === fastest.id
            ? `${rec.label} has the lowest estimated exposure among the eligible routes.`
            : fastest.blocked
              ? `${rec.label} is recommended because the fastest route crosses a confirmed closure.`
              : `${rec.label} lowers estimated exposure from ${formatExposure(fastest.exposure)} to ${formatExposure(rec.exposure)} compared with the fastest route, which meets the ${data.exposureThreshold.toFixed(2)} threshold.`,
      };
    case 'fastest_default':
      if (!fastest) break;
      return {
        title: 'Fastest route shown as default',
        body: `No alternative lowers estimated exposure by ${data.exposureThreshold.toFixed(2)} or more. Exposure note: ${fastest.label} has exposure ${formatExposure(fastest.exposure)}${fastest.flaggedSegmentIds.length ? ` with ${pluralize(fastest.flaggedSegmentIds.length, 'flagged segment')}` : ''}.`,
      };
    case 'no_lower_exposure':
      return {
        title: 'No lower-exposure route found',
        body: 'Every returned route is high, unknown or blocked. Consider whether the journey is needed.',
      };
  }
  return { title: 'Route comparison', body: '' };
}
