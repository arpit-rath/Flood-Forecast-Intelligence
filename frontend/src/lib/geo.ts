import type { LngLat, PilotResponse } from '../api/types';

// Small planar helpers for the pilot area (about 1 km across), where an
// equirectangular projection is accurate enough for drawing and labelling.

export type Bounds = [number, number, number, number];

const M_PER_DEG_LAT = 110_540;
const M_PER_DEG_LNG_EQUATOR = 111_320;

export function metresPerDegree(lat: number): { x: number; y: number } {
  return { x: M_PER_DEG_LNG_EQUATOR * Math.cos((lat * Math.PI) / 180), y: M_PER_DEG_LAT };
}

export function expandBounds([w, s, e, n]: Bounds, ratio: number): Bounds {
  const dx = (e - w) * ratio;
  const dy = (n - s) * ratio;
  return [w - dx, s - dy, e + dx, n + dy];
}

export interface Projection {
  project: (p: LngLat) => [number, number];
  /** Pixels per degree of latitude. */
  scale: number;
}

/** Fit `bounds` inside a width × height box, centred, preserving shape. */
export function fitProjection([w, s, e, n]: Bounds, width: number, height: number, padding = 0): Projection {
  const midLat = (s + n) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180);
  const spanX = (e - w) * kx;
  const spanY = n - s;
  const scale = Math.min((width - 2 * padding) / spanX, (height - 2 * padding) / spanY);
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;
  return {
    scale,
    project: ([lng, lat]) => [offsetX + (lng - w) * kx * scale, offsetY + (n - lat) * scale],
  };
}

export function midpoint(a: LngLat, b: LngLat): LngLat {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/** On-screen angle of a→b in degrees, folded to (-90, 90] so text never reads upside down. */
export function readableAngle(a: LngLat, b: LngLat): number {
  const kx = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  let deg = (Math.atan2(-(b[1] - a[1]), (b[0] - a[0]) * kx) * 180) / Math.PI;
  if (deg > 90) deg -= 180;
  if (deg <= -90) deg += 180;
  return Math.round(deg * 10) / 10;
}

export interface RoadLabel {
  name: string;
  point: LngLat;
  angle: number;
}

/**
 * One label per named road, placed on a block near its middle that is clear
 * of drain markers and named places. Names are grouped by the text before
 * " · " ("Central Avenue · block 4" → "Central Avenue"). Segments whose name
 * is only their ID (the local API) get no label.
 */
export function roadLabels(pilot: PilotResponse, clearanceM = 90): RoadLabel[] {
  const groups = new Map<string, LngLat[][]>();
  for (const f of pilot.segments.features) {
    if (f.properties.name === f.id) continue;
    const base = f.properties.name.split(' · ')[0];
    const list = groups.get(base) ?? [];
    list.push(f.geometry.coordinates);
    groups.set(base, list);
  }
  const avoid = [...pilot.drains.features.map((d) => d.geometry.coordinates), ...pilot.places.map((p) => p.point)];
  const m = metresPerDegree((pilot.bounds[1] + pilot.bounds[3]) / 2);
  const nearest = (p: LngLat) =>
    Math.min(Infinity, ...avoid.map((q) => Math.hypot((p[0] - q[0]) * m.x, (p[1] - q[1]) * m.y)));

  return [...groups.entries()].map(([name, lines]) => {
    const middle = (lines.length - 1) / 2;
    const scored = lines.map((line, i) => {
      const point = midpoint(line[0], line[line.length - 1]);
      const crowded = nearest(point) < clearanceM ? 10 : 0;
      return { line, point, score: Math.abs(i - middle) + crowded };
    });
    scored.sort((x, y) => x.score - y.score);
    const { line, point } = scored[0];
    return { name, point, angle: readableAngle(line[0], line[line.length - 1]) };
  });
}

/** Screen offset that sets a label beside its road instead of on it. */
export function labelOffset(angle: number, distancePx = 11): [number, number] {
  const rad = (angle * Math.PI) / 180;
  return [Math.round(Math.sin(rad) * distancePx), Math.round(-Math.cos(rad) * distancePx)];
}

/** Midpoint of a pilot segment, or null when the ID is not in the bundle. */
export function segmentMidpoint(pilot: PilotResponse, segmentId: string): LngLat | null {
  const f = pilot.segments.features.find((s) => s.id === segmentId);
  if (!f) return null;
  const c = f.geometry.coordinates;
  return midpoint(c[0], c[c.length - 1]);
}

/** Bounding box of a set of coordinates. */
export function boundsOf(points: LngLat[]): Bounds {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) {
    w = Math.min(w, x);
    e = Math.max(e, x);
    s = Math.min(s, y);
    n = Math.max(n, y);
  }
  return [w, s, e, n];
}
