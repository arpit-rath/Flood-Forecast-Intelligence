import type {
  AccessConcern,
  DrainState,
  FeatureKey,
  Hazard,
  ReviewStatus,
  RiskClass,
  TravelMode,
  VisibleWater,
} from '../api/types';

// User-facing wording (Design-System.md §7). Never "safe", never certainty.

export const RISK_LABEL: Record<RiskClass, string> = {
  low: 'Low',
  watch: 'Watch',
  high: 'High',
  unknown: 'Unknown',
};

export const RISK_DESCRIPTION: Record<RiskClass, string> = {
  low: 'Low risk estimate',
  watch: 'Watch: elevated risk estimate',
  high: 'High risk estimate',
  unknown: 'Unknown: not enough data to estimate',
};

export const FEATURE_LABEL: Record<FeatureKey, string> = {
  R: 'Rainfall intensity',
  T: 'Terrain low-point prior',
  D: 'Drainage vulnerability',
  O: 'Accepted observations',
};

export const REVIEW_LABEL: Record<ReviewStatus, string> = {
  analysis_pending: 'Analysis pending',
  pending_review: 'Pending review',
  needs_manual_review: 'Needs manual review',
  accepted: 'Accepted',
  rejected: 'Rejected',
};

export const REVIEW_DESCRIPTION: Record<ReviewStatus, string> = {
  analysis_pending: 'Photo uploaded. Image analysis is running.',
  pending_review: 'Photo analysis finished. Awaiting responder review; it does not change route advice yet.',
  needs_manual_review: 'Image analysis was unavailable. A responder will review the photo directly.',
  accepted: 'A responder accepted this report as evidence for the risk estimate.',
  rejected: 'A responder rejected this report. It does not enter the risk estimate.',
};

export const VISIBLE_WATER_LABEL: Record<VisibleWater, string> = {
  none: 'No visible water',
  possible: 'Possible standing water',
  clear: 'Standing water visible',
  uncertain: 'Uncertain',
};

export const DRAIN_STATE_LABEL: Record<DrainState, string> = {
  blocked: 'Drain appears blocked',
  clear: 'Drain appears clear',
  not_visible: 'No drain visible',
  uncertain: 'Uncertain',
};

export const ACCESS_LABEL: Record<AccessConcern, string> = {
  none: 'No visible access concern',
  possible: 'Possible access concern',
  clear: 'Clear access concern',
  uncertain: 'Uncertain',
};

export const HAZARD_LABEL: Record<Hazard, string> = {
  debris: 'Debris',
  open_manhole: 'Open manhole',
  stranded_vehicle: 'Stranded vehicle',
  person_in_water: 'Person in water',
  other: 'Other hazard',
};

export const TRAVEL_MODE_LABEL: Record<TravelMode, string> = {
  pedestrian: 'Walk',
  car: 'Drive',
};

/** Short qualified sentence for an AI observation awaiting review. */
export function observationHeadline(water: VisibleWater): string {
  switch (water) {
    case 'clear':
      return 'Photo analysis suggests standing water';
    case 'possible':
      return 'Photo analysis suggests possible standing water';
    case 'none':
      return 'Photo analysis did not find visible water';
    default:
      return 'Photo analysis is uncertain about visible water';
  }
}
