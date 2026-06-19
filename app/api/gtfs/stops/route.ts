import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { BusStop } from '@/lib/types'
import fs from 'fs'
import path from 'path'
import { parse } from 'csv-parse/sync'

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q')

  try {
    let query = supabase.from('stops').select('*')
    
    // Simple search functionality
    if (q) {
      query = query.ilike('stop_name', `%${q}%`)
    }

    // Limit to 50 for performance if no search
    query = query.limit(50)

    const { data, error } = await query

    if (error) {
      console.warn('Supabase stops fetch failed, falling back to local GTFS CSV:', error.message)
      
      try {
        const filePath = path.join(process.cwd(), 'kigali_gtfs', 'stops.txt')
        if (fs.existsSync(filePath)) {
          const fileContent = fs.readFileSync(filePath, 'utf-8')
          const records = parse(fileContent, { columns: true, skip_empty_lines: true })
          
          let filtered = records
          if (q) {
            filtered = records.filter((r: any) => 
              r.stop_name.toLowerCase().includes(q.toLowerCase())
            )
          }
          
          const mappedStops: BusStop[] = filtered.map((stop: any) => ({
            id: stop.stop_id,
            name: stop.stop_name,
            latitude: parseFloat(stop.stop_lat),
            longitude: parseFloat(stop.stop_lon),
            walkingDistance: Math.floor(Math.random() * 10) + 1,
            walkingMeters: Math.floor(Math.random() * 800) + 50,
          }))

          const stops: BusStop[] = []
          for (const s of mappedStops) {
            if (stops.length >= 50) break
            const isDup = stops.some(
              (existing) => haversineMeters(existing.latitude, existing.longitude, s.latitude, s.longitude) < 50
            )
            if (!isDup) {
              stops.push(s)
            }
          }
          
          return NextResponse.json({ stops })
        }
      } catch (fsError) {
        console.error('Local CSV fallback failed:', fsError)
      }
      
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // If data is null/empty because tables aren't populated, return an empty array
    if (!data || data.length === 0) {
      return NextResponse.json({ stops: [] })
    }

    // Map GTFS stops to our app's BusStop interface
    const mappedStops: BusStop[] = data.map((stop: any) => ({
      id: stop.stop_id,
      name: stop.stop_name,
      latitude: stop.stop_lat,
      longitude: stop.stop_lon,
      // Calculate a dummy walking distance for the prototype if we don't have user loc
      walkingDistance: Math.floor(Math.random() * 10) + 1,
      walkingMeters: Math.floor(Math.random() * 800) + 50,
    }))

    const stops: BusStop[] = []
    for (const s of mappedStops) {
      if (stops.length >= 50) break
      const isDup = stops.some(
        (existing) => haversineMeters(existing.latitude, existing.longitude, s.latitude, s.longitude) < 50
      )
      if (!isDup) {
        stops.push(s)
      }
    }

    return NextResponse.json({ stops })
  } catch (err) {
    console.error('Unexpected API error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
