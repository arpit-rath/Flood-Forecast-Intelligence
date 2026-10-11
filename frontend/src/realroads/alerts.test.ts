import { describe, expect, it } from 'vitest';
import { roads } from './model';
import { roadOverlay } from './overlay';

describe('public source-alert privacy boundary', () => {
  it('keeps mapped roads Unknown when only source-alert text is available', () => {
    const now = new Date('2026-10-11T12:00:00Z');
    const overlay = roadOverlay(null, [], now, roads);
    expect(overlay.features).toHaveLength(roads.features.length);
    expect(overlay.features.every((road) => road.properties.condition === 'unknown')).toBe(true);
  });
});
