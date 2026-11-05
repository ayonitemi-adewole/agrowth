import { describe, expect, it } from 'vitest';
import { duplicateFarmerId, errorMessage, overlappingFarms } from './errors';
import { filterValue } from './format';
import {
  approxHectares,
  polygonFromPoints,
  ringToLatLngs,
  selfIntersects,
  type LonLat,
} from './geo';

// Roughly 100 m × 100 m near Zaria.
const square: LonLat[] = [
  [7.7, 11.1],
  [7.7009, 11.1],
  [7.7009, 11.1009],
  [7.7, 11.1009],
];

describe('polygonFromPoints', () => {
  it('closes the ring', () => {
    const poly = polygonFromPoints(square)!;
    const ring = poly.coordinates[0];
    expect(ring).toHaveLength(5);
    expect(ring[4]).toEqual(ring[0]);
  });

  it('needs at least three corners', () => {
    expect(polygonFromPoints(square.slice(0, 2))).toBeNull();
  });
});

describe('approxHectares', () => {
  it('is within 1% of the PostGIS figure (0.979 ha for this square)', () => {
    expect(Math.abs(approxHectares(square) / 0.979 - 1)).toBeLessThan(0.01);
  });

  it('does not depend on drawing direction', () => {
    expect(approxHectares([...square].reverse())).toBeCloseTo(approxHectares(square), 6);
  });
});

describe('selfIntersects', () => {
  it('accepts a simple shape', () => {
    expect(selfIntersects(square)).toBe(false);
  });

  it('flags a bow-tie', () => {
    expect(selfIntersects([square[0], square[2], square[1], square[3]])).toBe(true);
  });
});

it('converts GeoJSON [lon, lat] to Leaflet [lat, lon]', () => {
  expect(ringToLatLngs(polygonFromPoints(square)!)[0]).toEqual([11.1, 7.7]);
});

describe('database error helpers', () => {
  it('finds the existing farmer on a duplicate enrolment', () => {
    const id = '0b6c8f0e-6a39-4c8d-9f63-2f6f0c2d1a11';
    expect(duplicateFarmerId({ code: 'PT409', message: 'dup', details: id })).toBe(id);
    expect(duplicateFarmerId({ code: 'PT400', message: 'x', details: id })).toBeNull();
  });

  it('reads the clashing farms on an overlap', () => {
    const details = JSON.stringify([{ farm_id: 'a', farmer_id: 'b', overlap_hectares: 0.4 }]);
    expect(overlappingFarms({ code: 'PT409', message: 'overlap', details })[0].farm_id).toBe('a');
    expect(overlappingFarms({ code: 'PT409', message: 'x', details: 'not json' })).toEqual([]);
  });

  it('explains permission errors in plain language', () => {
    expect(errorMessage({ code: '42501', message: 'permission denied for table farms' })).toBe(
      'Your role does not allow this action',
    );
  });
});

it('quotes search text for PostgREST filters', () => {
  expect(filterValue('%a,b(c)"d%')).toBe('"%a,b(c)\\"d%"');
});
