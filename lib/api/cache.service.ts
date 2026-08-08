/**
 * Smart Caching Service
 * Centralizes cache duration logic for Next.js edge/CDN caching
 * prioritizing 'stale-while-revalidate' for perceived realtime speed.
 */
export class CacheService {
  /**
   * Headers for fully static data (e.g. Route Shapes)
   * Cache for 1 day, revalidate background
   */
  static staticHeaders(): HeadersInit {
    return {
      'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=43200',
    }
  }

  /**
   * Headers for semi-static data (e.g. Search Suggestions)
   * Cache for 1 hour
   */
  static suggestionHeaders(): HeadersInit {
    return {
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    }
  }

  /**
   * Headers for live data (e.g. ETAs, Vehicles)
   * Micro-caching: Cache for 5 seconds at the edge to absorb traffic spikes,
   * but revalidate immediately.
   */
  static liveHeaders(): HeadersInit {
    return {
      'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=10',
    }
  }

  /**
   * Headers to explicitly disable caching (e.g. Status / Diagnostics)
   */
  static noCacheHeaders(): HeadersInit {
    return {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    }
  }
}
