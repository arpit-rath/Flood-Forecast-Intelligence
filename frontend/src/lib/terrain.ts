import type { LngLat, PilotResponse } from '../api/types';
import { expandBounds, metresPerDegree, midpoint, type Bounds } from './geo';

/*
 * Terrain context for the map: contour lines of the terrain low-point prior,
 * smoothed from the per-segment values in the pilot bundle. This is drawn as
 * quiet cartographic context only. It is not an elevation survey, a flood
 * extent, or an input to any score (those come from the API).
 */

export interface Sample {
  point: LngLat;
  value: number;
}

export interface Field {
  bounds: Bounds;
  cols: number;
  rows: number;
  /** Row-major, row 0 is the northern edge. */
  values: Float64Array;
}

export interface ContourLevel {
  level: number;
  lines: LngLat[][];
}

/** Gaussian-kernel smoothing of point samples onto a regular grid. */
export function smoothField(samples: Sample[], bounds: Bounds, cols: number, rows: number, bandwidthM: number): Field | null {
  if (samples.length === 0 || cols < 2 || rows < 2) return null;
  const [w, s, e, n] = bounds;
  const m = metresPerDegree((s + n) / 2);
  const twoH2 = 2 * bandwidthM * bandwidthM;
  const floor = Math.min(...samples.map((x) => x.value));
  const values = new Float64Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    const lat = n - (j / (rows - 1)) * (n - s);
    for (let i = 0; i < cols; i++) {
      const lng = w + (i / (cols - 1)) * (e - w);
      let sw = 0;
      let swv = 0;
      for (const sample of samples) {
        const dx = (sample.point[0] - lng) * m.x;
        const dy = (sample.point[1] - lat) * m.y;
        const k = Math.exp(-(dx * dx + dy * dy) / twoH2);
        sw += k;
        swv += k * sample.value;
      }
      // Far from every sample the kernel weight vanishes; fall back to the
      // lowest observed prior instead of amplifying numerical noise.
      const blend = Math.min(1, sw / 0.6);
      values[j * cols + i] = sw > 1e-9 ? blend * (swv / sw) + (1 - blend) * floor : floor;
    }
  }
  return { bounds, cols, rows, values };
}

type Edge = 0 | 1 | 2 | 3; // top, right, bottom, left

// Marching-squares cases; corner bits are tl=8, tr=4, br=2, bl=1.
const CASES: Record<number, [Edge, Edge][]> = {
  1: [[3, 2]],
  2: [[2, 1]],
  3: [[3, 1]],
  4: [[0, 1]],
  6: [[0, 2]],
  7: [[3, 0]],
  8: [[3, 0]],
  9: [[0, 2]],
  11: [[0, 1]],
  12: [[3, 1]],
  13: [[2, 1]],
  14: [[3, 2]],
};

/** Iso-line segments of `field` at `level`, in grid coordinates (x right, y down). */
export function isoSegments(field: Field, level: number): [number, number, number, number][] {
  const { cols, rows, values } = field;
  const v = (i: number, j: number) => values[j * cols + i];
  const out: [number, number, number, number][] = [];
  const lerp = (a: number, b: number) => (a === b ? 0.5 : (level - a) / (b - a));

  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const tl = v(i, j);
      const tr = v(i + 1, j);
      const br = v(i + 1, j + 1);
      const bl = v(i, j + 1);
      const index = (tl >= level ? 8 : 0) | (tr >= level ? 4 : 0) | (br >= level ? 2 : 0) | (bl >= level ? 1 : 0);
      if (index === 0 || index === 15) continue;

      let pairs = CASES[index];
      if (index === 5 || index === 10) {
        const centreInside = (tl + tr + br + bl) / 4 >= level;
        pairs =
          index === 5
            ? centreInside
              ? [[3, 0], [2, 1]]
              : [[3, 2], [0, 1]]
            : centreInside
              ? [[0, 1], [3, 2]]
              : [[3, 0], [2, 1]];
      }

      const point = (edge: Edge): [number, number] => {
        switch (edge) {
          case 0:
            return [i + lerp(tl, tr), j];
          case 1:
            return [i + 1, j + lerp(tr, br)];
          case 2:
            return [i + lerp(bl, br), j + 1];
          default:
            return [i, j + lerp(tl, bl)];
        }
      };
      for (const [a, b] of pairs) {
        const [x1, y1] = point(a);
        const [x2, y2] = point(b);
        out.push([x1, y1, x2, y2]);
      }
    }
  }
  return out;
}

/** Join touching segments into polylines so lines render with clean joins. */
export function chainSegments(segments: [number, number, number, number][]): [number, number][][] {
  const key = (x: number, y: number) => `${x.toFixed(4)},${y.toFixed(4)}`;
  const ends = new Map<string, number[]>();
  segments.forEach(([x1, y1, x2, y2], idx) => {
    for (const k of [key(x1, y1), key(x2, y2)]) {
      const list = ends.get(k) ?? [];
      list.push(idx);
      ends.set(k, list);
    }
  });
  const used = new Uint8Array(segments.length);
  const lines: [number, number][][] = [];

  const extend = (line: [number, number][], atEnd: boolean) => {
    for (;;) {
      const tip = atEnd ? line[line.length - 1] : line[0];
      const next = (ends.get(key(tip[0], tip[1])) ?? []).find((idx) => !used[idx]);
      if (next === undefined) return;
      used[next] = 1;
      const [x1, y1, x2, y2] = segments[next];
      const forward = key(x1, y1) === key(tip[0], tip[1]);
      const p: [number, number] = forward ? [x2, y2] : [x1, y1];
      if (atEnd) line.push(p);
      else line.unshift(p);
    }
  };

  segments.forEach(([x1, y1, x2, y2], idx) => {
    if (used[idx]) return;
    used[idx] = 1;
    const line: [number, number][] = [
      [x1, y1],
      [x2, y2],
    ];
    extend(line, true);
    extend(line, false);
    lines.push(line);
  });
  return lines;
}

export function contours(field: Field, levels: number[]): ContourLevel[] {
  const [w, s, e, n] = field.bounds;
  const toLngLat = ([x, y]: [number, number]): LngLat => [
    w + (x / (field.cols - 1)) * (e - w),
    n - (y / (field.rows - 1)) * (n - s),
  ];
  return levels.map((level) => ({
    level,
    lines: chainSegments(isoSegments(field, level)).map((line) => line.map(toLngLat)),
  }));
}

export const TERRAIN_LEVELS = [0.15, 0.22, 0.3, 0.38, 0.46, 0.54];

/**
 * Contours of the terrain low-point prior over (and slightly beyond) the
 * pilot area. Returns an empty list when the bundle has no terrain values.
 */
export function terrainContours(pilot: PilotResponse, { margin = 0.35, cols = 72, rows = 56 } = {}): ContourLevel[] {
  const samples: Sample[] = [];
  for (const f of pilot.segments.features) {
    const value = f.properties.terrainPrior;
    if (value === null || !Number.isFinite(value)) continue;
    const coords = f.geometry.coordinates;
    samples.push({ point: midpoint(coords[0], coords[coords.length - 1]), value });
    for (const point of coords) samples.push({ point, value });
  }
  const field = smoothField(samples, expandBounds(pilot.bounds, margin), cols, rows, 95);
  if (!field) return [];
  return contours(field, TERRAIN_LEVELS).filter((c) => c.lines.length > 0);
}
