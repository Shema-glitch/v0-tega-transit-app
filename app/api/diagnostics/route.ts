import { NextResponse } from 'next/server'
import { LiveVehicleStore } from '@/lib/api/live-store'
import { TelemetryService } from '@/lib/api/telemetry.service'
import { CacheService } from '@/lib/api/cache.service'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const vehicleDiagnostics = LiveVehicleStore.getDiagnostics()
    
    // Determine which buses are having trouble
    const troubledBuses = Object.entries(vehicleDiagnostics)
      .filter(([_, diag]) => diag.status !== 'healthy')
      .map(([id, diag]) => ({
        vehicleId: id,
        ...diag
      }))

    const systemHealth = {
      overall: troubledBuses.length > 5 ? 'degraded' : 'healthy',
      activeSSEConnections: TelemetryService.activeSSEConnections,
      averageApiLatencyMs: TelemetryService.getAverageLatency(),
      troubledBusesCount: troubledBuses.length,
      troubledBuses,
      timestamp: new Date().toISOString()
    }

    return NextResponse.json(systemHealth, { headers: CacheService.noCacheHeaders() })
  } catch (error) {
    console.error('Diagnostics API Error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
