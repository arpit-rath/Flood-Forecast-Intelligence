import { expect, test } from 'vitest';
import type { PilotResponse } from '../api/types';
import pilotFixture from '../api/mock/fixtures/pilot.json';
import { fitProjection, readableAngle, roadLabels } from './geo';
import { contours, isoSegments, smoothField, terrainContours, type Field } from './terrain';

const pilot = pilotFixture as unknown as PilotResponse;

function grid(values: number[][]): Field {
  return { bounds: [0, 0, 1, 1], cols: values[0].length, rows: values.length, values: Float64Array.from(values.flat()) };
}

test('a single raised cell produces one closed contour ring', () => {
  const field = grid([
    [0, 0, 0],
    [0, 1, 0],
    [0, 0, 0],
  ]);
  expect(isoSegments(field, 0.5)).toHaveLength(4);
  const [ring] = contours(field, [0.5]);
  expect(ring.lines).toHaveLength(1);
  const line = ring.lines[0];
  expect(line[0]).toEqual(line[line.length - 1]);
});

test('levels outside the value range produce no lines', () => {
  const field = grid([
    [0.1, 0.2],
    [0.3, 0.4],
  ]);
  expect(isoSegments(field, 0.9)).toHaveLength(0);
  expect(isoSegments(field, 0.05)).toHaveLength(0);
});

test('smoothing is deterministic and stays within the sample range', () => {
  const samples = [
    { point: [77.115, 28.75] as [number, number], value: 0.1 },
    { point: [77.118, 28.751] as [number, number], value: 0.6 },
  ];
  const a = smoothField(samples, [77.11, 28.745, 77.125, 28.755], 20, 16, 120)!;
  const b = smoothField(samples, [77.11, 28.745, 77.125, 28.755], 20, 16, 120)!;
  expect(Array.from(a.values)).toEqual(Array.from(b.values));
  for (const v of a.values) {
    expect(v).toBeGreaterThanOrEqual(0.1 - 1e-9);
    expect(v).toBeLessThanOrEqual(0.6 + 1e-9);
  }
  expect(smoothField([], [0, 0, 1, 1], 4, 4, 100)).toBeNull();
});

test('pilot terrain contours ignore missing priors and surround the low-lying centre', () => {
  const levels = terrainContours(pilot);
  expect(levels.length).toBeGreaterThan(0);
  const [w, s, e, n] = pilot.bounds;
  const highest = levels[levels.length - 1];
  for (const line of highest.lines) {
    for (const [lng, lat] of line) {
      // The strongest low-point prior sits inside the pilot network.
      expect(lng).toBeGreaterThan(w);
      expect(lng).toBeLessThan(e);
      expect(lat).toBeGreaterThan(s);
      expect(lat).toBeLessThan(n);
    }
  }

  const noTerrain: PilotResponse = {
    ...pilot,
    segments: {
      ...pilot.segments,
      features: pilot.segments.features.map((f) => ({ ...f, properties: { ...f.properties, terrainPrior: null } })),
    },
  };
  expect(terrainContours(noTerrain)).toEqual([]);
});

test('road labels group blocks by name and keep text upright', () => {
  const labels = roadLabels(pilot);
  const names = labels.map((l) => l.name);
  expect(names).toContain('Central Avenue');
  expect(new Set(names).size).toBe(names.length);
  for (const l of labels) {
    expect(l.angle).toBeGreaterThan(-90);
    expect(l.angle).toBeLessThanOrEqual(90);
  }
  expect(readableAngle([0, 0], [-1, 0])).toBe(0);
  expect(Math.abs(readableAngle([0, 0], [0, 1]))).toBe(90);
});

test('projection keeps the pilot inside the drawing box', () => {
  const projection = fitProjection(pilot.bounds, 400, 300, 20);
  const [w, s, e, n] = pilot.bounds;
  for (const corner of [
    [w, s],
    [e, n],
  ] as [number, number][]) {
    const [x, y] = projection.project(corner);
    expect(x).toBeGreaterThanOrEqual(19.9);
    expect(x).toBeLessThanOrEqual(380.1);
    expect(y).toBeGreaterThanOrEqual(19.9);
    expect(y).toBeLessThanOrEqual(280.1);
  }
});
