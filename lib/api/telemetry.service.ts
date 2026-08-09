/**
 * Lightweight Telemetry Service
 * Tracks critical realtime infrastructure health and usage metrics in-memory.
 */

// SSE connection ceiling. Defensive OOM guard — per-client SSE state is a
// few KB (delta Map + viewer sets), so a few hundred connections fit fine on
// a standard instance; raise it via MAX_SSE_CONNECTIONS once you're on a
// paid instance (see docs/DEPLOYMENT_GUIDE.md §Scaling).
export const MAX_SSE_CONNECTIONS = Number(process.env.MAX_SSE_CONNECTIONS) || 250
class TelemetryTracker {
  activeSSEConnections: number = 0
  totalSSEMessagesSent: number = 0
  totalBytesTransmitted: number = 0
  lastApiLatencies: number[] = []

  // Add latency
  recordLatency(ms: number) {
    this.lastApiLatencies.push(ms)
    if (this.lastApiLatencies.length > 50) {
      this.lastApiLatencies.shift() // Keep last 50
    }
  }

  // Get average latency
  getAverageLatency(): number {
    if (this.lastApiLatencies.length === 0) return 0
    const sum = this.lastApiLatencies.reduce((a, b) => a + b, 0)
    return Math.round(sum / this.lastApiLatencies.length)
  }

  // Record outgoing SSE payload
  recordSSEMessage(bytes: number) {
    this.totalSSEMessagesSent++
    this.totalBytesTransmitted += bytes
  }

  // Get average payload size
  getAveragePayloadSize(): number {
    if (this.totalSSEMessagesSent === 0) return 0
    return Math.round(this.totalBytesTransmitted / this.totalSSEMessagesSent)
  }

  clientConnected() {
    this.activeSSEConnections++
  }

  clientDisconnected() {
    this.activeSSEConnections = Math.max(0, this.activeSSEConnections - 1)
  }
}

// Export as a singleton
export const TelemetryService = new TelemetryTracker()

/**
 * Wrap a route handler body to record real request latency into
 * TelemetryService, so /api/status's averageApiLatencyMs reflects actual
 * traffic instead of always reading 0 (docs/BACKEND_HANDOFF.md #13).
 */
export async function withLatencyTracking<T>(fn: () => Promise<T>): Promise<T> {
  const start = performance.now()
  try {
    return await fn()
  } finally {
    TelemetryService.recordLatency(Math.round(performance.now() - start))
  }
}
