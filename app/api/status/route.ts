import { NextResponse } from 'next/server'
import { SystemStatusSchema } from '@/lib/api/validation'
import { CacheService } from '@/lib/api/cache.service'
import { supabase } from '@/lib/supabase'
import { TelemetryService } from '@/lib/api/telemetry.service'
import { MaintenanceStore } from '@/lib/api/maintenance-store'
import { ErrorLog } from '@/lib/api/error-log'

export async function GET() {
  try {
    // Check DB connection via a quick health ping
    const { error: dbError } = await supabase.from('stops').select('stop_id').limit(1)

    if (dbError) {
      ErrorLog.record({ path: '/api/status', method: 'GET', status: 503, message: `Database unreachable: ${dbError.message}` })
    }
    
    const statusData = {
      status: dbError ? 'degraded' : 'healthy',
      database: dbError ? 'disconnected' : 'connected',
      realtimeServices: 'fallback', // 'active' when connected to Redis/Supabase Channels
      gtfsFreshnessHours: 24, // Ideally fetched from an import_logs table
      outages: dbError ? ['database_unreachable'] : [],
      maintenance: MaintenanceStore.getAll(),
      telemetry: {
        activeSSEConnections: TelemetryService.activeSSEConnections,
        averagePayloadSizeBytes: TelemetryService.getAveragePayloadSize(),
        averageApiLatencyMs: TelemetryService.getAverageLatency(),
        totalMessagesSent: TelemetryService.totalSSEMessagesSent
      },
      timestamp: new Date().toISOString()
    }

    const validated = SystemStatusSchema.parse(statusData)

    return NextResponse.json(validated, { 
      headers: CacheService.noCacheHeaders(),
      status: dbError ? 503 : 200
    })
  } catch (error) {
    console.error('Status API Error:', error)
    ErrorLog.record({ path: '/api/status', method: 'GET', status: 500, message: error instanceof Error ? error.message : 'Unknown error' })
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
