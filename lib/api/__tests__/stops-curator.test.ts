import { describe, it, expect } from 'vitest'
import { findDuplicateClusters, type ClusterStop } from '@/lib/api/stops-curator'

/** Kigali grid around -1.94, 30.06 — ~111 m per 0.001° lat, ~101 m per 0.001° lon. */
function stop(id: string, name: string, lat: number, lon: number, stopTimesCount = 1): ClusterStop {
  return { id, name, lat, lon, stopTimesCount }
}

describe('findDuplicateClusters', () => {
  it('groups stops within the radius into one cluster', () => {
    const clusters = findDuplicateClusters(
      [
        stop('a', 'Kimironko', -1.943, 30.062, 40),
        stop('b', 'Kimironko 2', -1.9431, 30.0621, 12),
        stop('c', 'Kimironko Stop', -1.9432, 30.0622, 5),
      ],
      60
    )
    expect(clusters).toHaveLength(1)
    expect(clusters[0].stops).toHaveLength(3)
    // The stop with the most stop_times is the anchor (merge survivor).
    expect(clusters[0].anchor.id).toBe('a')
  })

  it('leaves far-apart stops alone', () => {
    const clusters = findDuplicateClusters(
      [
        stop('kacyiru', 'Kacyiru', -1.943, 30.062),
        stop('nyabugogo', 'Nyabugogo', -1.945, 30.052), // ~1.2 km away
      ],
      60
    )
    expect(clusters).toHaveLength(0)
  })

  it('chains stops together transitively (A≈B, B≈C, A≉C)', () => {
    const clusters = findDuplicateClusters(
      [
        stop('a', 'A', -1.943, 30.062),
        stop('b', 'B', -1.94305, 30.06205), // ~7 m from A
        stop('c', 'C', -1.9431, 30.0621), // ~7 m from B, ~14 m from A
      ],
      10
    )
    expect(clusters).toHaveLength(1)
    expect(clusters[0].stops).toHaveLength(3)
  })

  it('separates two distinct clusters', () => {
    const clusters = findDuplicateClusters(
      [
        stop('a', 'A', -1.943, 30.062),
        stop('b', 'B', -1.9431, 30.0621),
        stop('c', 'C', -1.945, 30.052),
        stop('d', 'D', -1.9451, 30.0521),
      ],
      60
    )
    expect(clusters).toHaveLength(2)
  })

  it('reports the max span of the cluster', () => {
    const clusters = findDuplicateClusters(
      [
        stop('a', 'A', -1.943, 30.062),
        stop('b', 'B', -1.9431, 30.0621), // ~14 m
      ],
      60
    )
    expect(clusters[0].maxSpanMeters).toBeGreaterThan(10)
    expect(clusters[0].maxSpanMeters).toBeLessThan(20)
  })

  it('sorts clusters by span ascending (tightest first)', () => {
    const clusters = findDuplicateClusters(
      [
        stop('far1', 'F1', -1.940, 30.060),
        stop('far2', 'F2', -1.941, 30.061), // ~130 m apart — still within 200
        stop('close1', 'C1', -1.950, 30.070),
        stop('close2', 'C2', -1.95001, 30.07001), // ~1.5 m
      ],
      200
    )
    expect(clusters).toHaveLength(2)
    expect(clusters[0].maxSpanMeters).toBeLessThan(clusters[1].maxSpanMeters)
    expect(clusters[0].stops[0].id).toBe('close1')
  })
})
