import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  const startTime = Date.now()

  try {
    // Ping Supabase to check database connectivity
    const { error } = await supabase.from('stops').select('stop_id').limit(1)

    const responseTime = Date.now() - startTime

    if (error) {
      return NextResponse.json(
        {
          status: 'degraded',
          database: 'disconnected',
          message: error.message,
          uptime: process.uptime(),
          responseTimeMs: responseTime,
          timestamp: new Date().toISOString(),
        },
        { status: 503 }
      )
    }

    return NextResponse.json(
      {
        status: 'healthy',
        database: 'connected',
        uptime: process.uptime(),
        responseTimeMs: responseTime,
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    )
  } catch (error: any) {
    return NextResponse.json(
      {
        status: 'down',
        database: 'disconnected',
        message: error.message || 'Internal Server Error',
        uptime: process.uptime(),
        responseTimeMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}
