import { likePattern } from '../common/pagination';
import { MAX_POSITIONS_PER_RING, polygonProblem, toPolygon2d } from './geojson';

const square = [
  [7.7, 11.1],
  [7.701, 11.1],
  [7.701, 11.101],
  [7.7, 11.101],
  [7.7, 11.1],
];

describe('polygonProblem', () => {
  it('accepts a closed polygon', () => {
    expect(polygonProblem({ type: 'Polygon', coordinates: [square] })).toBeNull();
  });

  it('accepts a polygon with a hole and with altitude values', () => {
    const hole = [
      [7.7002, 11.1002, 300],
      [7.7004, 11.1002, 300],
      [7.7004, 11.1004, 300],
      [7.7002, 11.1002, 300],
    ];
    expect(polygonProblem({ type: 'Polygon', coordinates: [square, hole] })).toBeNull();
  });

  it.each([
    [null, 'must be a GeoJSON object'],
    [{ type: 'Point', coordinates: [7.7, 11.1] }, 'type must be "Polygon"'],
    [{ type: 'Polygon', coordinates: [] }, 'non-empty array'],
    [{ type: 'Polygon', coordinates: [square.slice(0, 3)] }, 'at least 4 positions'],
    [{ type: 'Polygon', coordinates: [[...square.slice(0, 4), [7.7, 11.2]]] }, 'must be closed'],
    [{ type: 'Polygon', coordinates: [[[200, 11], ...square.slice(1)]] }, 'longitude'],
    [{ type: 'Polygon', coordinates: [[[7.7, 95], ...square.slice(1)]] }, 'latitude'],
    [{ type: 'Polygon', coordinates: [[['7.7', 11.1], ...square.slice(1)]] }, 'finite numbers'],
    [{ type: 'Polygon', coordinates: [[[7.7], ...square.slice(1)]] }, '[longitude, latitude]'],
  ])('rejects %j', (value, problem) => {
    expect(polygonProblem(value)).toContain(problem);
  });

  it('rejects an oversized ring', () => {
    const ring = Array.from({ length: MAX_POSITIONS_PER_RING + 1 }, () => [7.7, 11.1]);
    expect(polygonProblem({ type: 'Polygon', coordinates: [ring] })).toContain('more than');
  });
});

describe('toPolygon2d', () => {
  it('drops altitude', () => {
    const poly = toPolygon2d({
      type: 'Polygon',
      coordinates: [square.map(([x, y]) => [x, y, 250])],
    });
    expect(poly.coordinates[0].every((p) => p.length === 2)).toBe(true);
  });
});

describe('likePattern', () => {
  it('escapes LIKE wildcards', () => {
    expect(likePattern('50%_a\\b')).toBe('%50\\%\\_a\\\\b%');
  });
});
