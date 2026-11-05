import type { Polygon, Position } from 'geojson';

/** A point the field agent has placed: [longitude, latitude], the GeoJSON order. */
export type LonLat = [number, number];

const EARTH_RADIUS_M = 6_378_137;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Builds a closed GeoJSON polygon from the corners a user placed, in order. */
export function polygonFromPoints(points: LonLat[]): Polygon | null {
  if (points.length < 3) return null;
  const ring: Position[] = points.map(([lon, lat]) => [lon, lat]);
  ring.push([points[0][0], points[0][1]]);
  return { type: 'Polygon', coordinates: [ring] };
}

/**
 * Approximate area in hectares, for live feedback while drawing.
 * The database computes the official figure.
 */
export function approxHectares(points: LonLat[]): number {
  if (points.length < 3) return 0;
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const [lon1, lat1] = points[i];
    const [lon2, lat2] = points[(i + 1) % points.length];
    total += toRad(lon2 - lon1) * (2 + Math.sin(toRad(lat1)) + Math.sin(toRad(lat2)));
  }
  return Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2) / 10_000;
}

/** Do any two non-adjacent edges cross? A crossing boundary is not a valid farm. */
export function selfIntersects(points: LonLat[]): boolean {
  const n = points.length;
  if (n < 4) return false;
  const edge = (i: number): [LonLat, LonLat] => [points[i], points[(i + 1) % n]];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue; // neighbours share a corner
      if (segmentsCross(...edge(i), ...edge(j))) return true;
    }
  }
  return false;
}

function segmentsCross(a: LonLat, b: LonLat, c: LonLat, d: LonLat): boolean {
  const orient = (p: LonLat, q: LonLat, r: LonLat) =>
    Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return orient(a, b, c) !== orient(a, b, d) && orient(c, d, a) !== orient(c, d, b);
}

/** Leaflet uses [lat, lon]; GeoJSON uses [lon, lat]. */
export function ringToLatLngs(polygon: Polygon): [number, number][] {
  return polygon.coordinates[0].map(([lon, lat]) => [lat, lon]);
}
