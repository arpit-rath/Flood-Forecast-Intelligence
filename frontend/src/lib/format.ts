// Display formatting only. All values arrive computed from the API.

const IST = 'Asia/Kolkata';

const timeFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const dateFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST,
  day: 'numeric',
  month: 'short',
});

/** "17:00 IST, 8 Oct" — API times are UTC ISO 8601; the UI shows India Standard Time. */
export function formatTimeIST(iso: string | null | undefined): string {
  if (!iso) return 'Not recorded';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Invalid time';
  return `${timeFormatter.format(date)} IST, ${dateFormatter.format(date)}`;
}

export function formatScore(score: number | null | undefined): string {
  return score === null || score === undefined ? 'No score' : score.toFixed(2);
}

export function formatExposure(exposure: number | null | undefined): string {
  return exposure === null || exposure === undefined ? 'Not assessed' : exposure.toFixed(2);
}

export function formatMinutes(minutes: number): string {
  return `${Math.round(minutes)} min`;
}

export function formatExtraMinutes(minutes: number): string {
  const rounded = Math.round(minutes);
  if (rounded === 0) return 'same time';
  return rounded > 0 ? `+${rounded} min` : `${rounded} min`;
}

export function formatPercent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

export function formatDistance(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres)} m`;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
