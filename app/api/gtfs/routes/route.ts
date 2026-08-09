import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import fs from 'fs'
import path from 'path'
import { parse } from 'csv-parse/sync'
import { withRequestMetrics } from '@/lib/api/request-metrics'
import { cacheWrap } from '@/lib/api/ttl-cache'

const ROUTES_TTL_MS = 60 * 60 * 1000 // 1 hour — routes are static between GTFS imports

// csv-parse types rows as unknown[] — describe the GTFS columns we read.
interface GtfsRouteRow {
  route_id: string
  route_short_name?: string
  route_long_name?: string
  route_color?: string
}

export async function GET() {
  return withRequestMetrics('gtfs.routes', () => handleGet())
}

async function handleGet() {
  try {
    let routes: unknown[] | null = null
    let dbErrorMsg: string | null = null

    try {
      routes = await cacheWrap('gtfs-routes', ROUTES_TTL_MS, async () => {
        const { data, error } = await supabase
          .from('routes')
          .select('*')
          .limit(50)

        if (error) throw new Error(error.message)
        if (!data || data.length === 0) return []

        return data.map((route) => ({
          id: route.route_id,
          number: route.route_short_name,
          name: route.route_long_name,
          color: route.route_color ? `#${route.route_color}` : '#00a896',
        }))
      })
    } catch (err) {
      // A Supabase failure is never cached — fall back to local GTFS CSV,
      // exactly as before the cache existed.
      dbErrorMsg = err instanceof Error ? err.message : String(err)
      console.warn('Supabase routes fetch failed, falling back to local GTFS CSV:', dbErrorMsg)

      try {
        const filePath = path.join(process.cwd(), 'kigali_gtfs', 'routes.txt')
        if (fs.existsSync(filePath)) {
          const fileContent = fs.readFileSync(filePath, 'utf-8')
          const records = parse(fileContent, { columns: true, skip_empty_lines: true }) as GtfsRouteRow[]

          routes = records.slice(0, 50).map((route) => ({
            id: route.route_id,
            number: route.route_short_name,
            name: route.route_long_name,
            color: route.route_color ? `#${route.route_color}` : '#00a896',
          }))
        }
      } catch (fsError) {
        console.error('Local CSV fallback failed:', fsError)
      }

      if (routes === null) {
        return NextResponse.json({ error: dbErrorMsg }, { status: 500 })
      }
    }

    return NextResponse.json({ routes })
  } catch (err) {
    console.error('Unexpected API error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
