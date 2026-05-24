/**
 * Utility functions for minimizing payload size over unstable networks.
 */

/**
 * Truncates a floating point coordinate to a specific number of decimal places.
 * 5 decimal places = ~1.1m precision, which is perfect for transit tracking.
 * 
 * Example: -1.953612345678912 -> -1.95361
 */
export function truncateGeo(coord: number, decimals: number = 5): number {
  const factor = Math.pow(10, decimals)
  return Math.round(coord * factor) / factor
}
