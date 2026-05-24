import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import fs from 'fs'
import path from 'path'
import { parse } from 'csv-parse/sync'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: stopId } = await params

  try {
    // Attempt Supabase fetch
    // To do this in Supabase we would need a join or a view. 
    // We'll simulate the join using the local files as the primary reliable method right now.
    
    // We skip the direct supabase fetch because the user's DB doesn't have the tables yet,
    // and doing a complex join without a proper SQL function over the REST API is slow.
    // Let's use the local CSV files directly for robust prototype performance!

    const stopTimesPath = path.join(process.cwd(), 'kigali_gtfs', 'stop_times.txt')
    const tripsPath = path.join(process.cwd(), 'kigali_gtfs', 'trips.txt')
    const routesPath = path.join(process.cwd(), 'kigali_gtfs', 'routes.txt')

    if (!fs.existsSync(stopTimesPath) || !fs.existsSync(tripsPath) || !fs.existsSync(routesPath)) {
      return NextResponse.json({ error: 'GTFS data not found locally' }, { status: 404 })
    }

    // 1. Find all trips that stop at this stop
    const stopTimesContent = fs.readFileSync(stopTimesPath, 'utf-8')
    const stopTimes = parse(stopTimesContent, { columns: true, skip_empty_lines: true })
    const tripIdsAtStop = new Set<string>()
    for (const st of stopTimes) {
      if ((st as any).stop_id === stopId) {
        tripIdsAtStop.add((st as any).trip_id)
      }
    }

    // 2. Find all routes for those trips
    const tripsContent = fs.readFileSync(tripsPath, 'utf-8')
    const trips = parse(tripsContent, { columns: true, skip_empty_lines: true })
    const routeIdsAtStop = new Set<string>()
    for (const t of trips) {
      if (tripIdsAtStop.has((t as any).trip_id)) {
        routeIdsAtStop.add((t as any).route_id)
      }
    }

    // 3. Get the route details
    const routesContent = fs.readFileSync(routesPath, 'utf-8')
    const allRoutes = parse(routesContent, { columns: true, skip_empty_lines: true })
    
    const matchingRoutes = allRoutes
      .filter((r: any) => routeIdsAtStop.has(r.route_id))
      .map((route: any) => ({
        id: route.route_id,
        number: route.route_short_name,
        name: route.route_long_name,
        color: route.route_color ? `#${route.route_color}` : '#00a896',
      }))

    return NextResponse.json({ routes: matchingRoutes })

  } catch (err) {
    console.error('Unexpected API error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
