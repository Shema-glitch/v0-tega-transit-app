/**
 * Shared geospatial helpers.
 * Single source of truth — do not re-implement haversine in route handlers.
 */

/** Haversine distance in metres between two WGS-84 coordinates. */
export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Walking time in whole minutes at ~1.4 m/s (84 m/min). */
export function walkingMinutes(meters: number): number {
  return Math.ceil(meters / 84)
}
