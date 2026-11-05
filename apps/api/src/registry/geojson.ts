import type { Polygon } from 'geojson';
import { registerDecorator, ValidationOptions } from 'class-validator';

/** Upper bounds that keep a single request from carrying an absurd geometry. */
export const MAX_RINGS = 20;
export const MAX_POSITIONS_PER_RING = 5000;

/**
 * Checks that a value is a GeoJSON Polygon in WGS84 (longitude, latitude).
 * Returns a human-readable problem, or null if the shape is acceptable.
 *
 * This only checks structure. Topology (self-intersection, etc.) is checked by
 * PostGIS, which is the authority on whether a polygon is valid.
 */
export function polygonProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return 'must be a GeoJSON object';
  const geo = value as { type?: unknown; coordinates?: unknown };
  if (geo.type !== 'Polygon') return 'type must be "Polygon"';
  if (!Array.isArray(geo.coordinates) || geo.coordinates.length === 0) {
    return 'coordinates must be a non-empty array of linear rings';
  }
  if (geo.coordinates.length > MAX_RINGS) return `may have at most ${MAX_RINGS} rings`;

  for (const [r, ring] of geo.coordinates.entries()) {
    const label = r === 0 ? 'outer ring' : `hole ${r}`;
    if (!Array.isArray(ring) || ring.length < 4) {
      return `${label} needs at least 4 positions (a closed triangle)`;
    }
    if (ring.length > MAX_POSITIONS_PER_RING) {
      return `${label} has more than ${MAX_POSITIONS_PER_RING} positions`;
    }
    for (const [p, pos] of ring.entries()) {
      if (!Array.isArray(pos) || pos.length < 2 || pos.length > 3) {
        return `${label} position ${p} must be [longitude, latitude]`;
      }
      const [lon, lat] = pos as unknown[];
      if (typeof lon !== 'number' || typeof lat !== 'number' || !isFinite(lon) || !isFinite(lat)) {
        return `${label} position ${p} must contain finite numbers`;
      }
      if (lon < -180 || lon > 180) return `${label} position ${p} longitude is out of range`;
      if (lat < -90 || lat > 90) return `${label} position ${p} latitude is out of range`;
    }
    const first = ring[0] as number[];
    const last = ring[ring.length - 1] as number[];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      return `${label} must be closed (first and last positions equal)`;
    }
  }
  return null;
}

/** Strips any altitude so the stored geometry is strictly 2D. */
export function toPolygon2d(value: Polygon): Polygon {
  return {
    type: 'Polygon',
    coordinates: value.coordinates.map((ring) => ring.map(([lon, lat]) => [lon, lat])),
  };
}

export function IsGeoJsonPolygon(options?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isGeoJsonPolygon',
      target: target.constructor,
      propertyName: propertyName as string,
      options,
      validator: {
        validate: (value: unknown) => polygonProblem(value) === null,
        defaultMessage: (args) => `${args?.property} ${polygonProblem(args?.value)}`,
      },
    });
  };
}
