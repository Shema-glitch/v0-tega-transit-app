/**
 * Lightweight Telemetry Service
 * Tracks critical realtime infrastructure health and usage metrics in-memory.
 */
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
