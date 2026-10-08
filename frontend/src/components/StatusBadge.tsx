import {
  Ban,
  CircleCheck,
  CircleDashed,
  CircleX,
  FlaskConical,
  Hourglass,
  OctagonAlert,
  TriangleAlert,
  UserCheck,
  type LucideIcon,
} from 'lucide-react';
import type { ReviewStatus, RiskClass } from '../api/types';
import { REVIEW_LABEL, RISK_LABEL } from '../lib/copy';

const RISK_ICON: Record<RiskClass, LucideIcon> = {
  low: CircleCheck,
  watch: TriangleAlert,
  high: OctagonAlert,
  unknown: CircleDashed,
};

/** Risk class or Closed, always as text plus icon (never colour alone). */
export function StatusBadge({ status, size = 'md' }: { status: RiskClass | 'closed'; size?: 'sm' | 'md' }) {
  const Icon = status === 'closed' ? Ban : RISK_ICON[status];
  const label = status === 'closed' ? 'Closed' : RISK_LABEL[status];
  return (
    <span className={`badge badge--${status} badge--${size}`}>
      <Icon aria-hidden="true" size={size === 'sm' ? 14 : 16} strokeWidth={2.25} />
      {label}
    </span>
  );
}

const REVIEW_ICON: Record<ReviewStatus, LucideIcon> = {
  analysis_pending: Hourglass,
  pending_review: Hourglass,
  needs_manual_review: TriangleAlert,
  accepted: UserCheck,
  rejected: CircleX,
};

export function ReviewBadge({ status }: { status: ReviewStatus }) {
  const Icon = REVIEW_ICON[status];
  return (
    <span className={`tag tag--review-${status}`}>
      <Icon aria-hidden="true" size={14} strokeWidth={2.25} />
      {REVIEW_LABEL[status]}
    </span>
  );
}

export function SimulatedTag({ label = 'Simulated' }: { label?: string }) {
  return (
    <span className="tag tag--simulated">
      <FlaskConical aria-hidden="true" size={14} strokeWidth={2.25} />
      {label}
    </span>
  );
}

export function Tag({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'action' | 'warning' }) {
  return <span className={`tag tag--${tone}`}>{children}</span>;
}
