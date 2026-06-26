import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
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

/**
 * Name validation: reject garbage / meaningless stop names.
 */
function isValidStopName(name: string): boolean {
  if (!name || name === 'Unknown Stop') return false
  const clean = name.trim()
  if (clean.length <= 1) return false
  // Pure number or alphanumeric code like "X12" or "3B"
  if (/^[A-Za-z]?\d+[A-Za-z]?$/.test(clean)) return false
  // Whitespace or punctuation only
  if (/^[\s\-_.]+$/.test(clean)) return false
  // Common test / placeholder names
  if (/^(test|temp|null|undefined|todo|fixme|n\/a)$/i.test(clean)) return false
  return true
}

/**
 * Spatial deduplication: keeps the first stop within 50m of any already-kept stop.
 * Prefers the stop with the longer name when duplicates are found.
 */
function deduplicateStops(stops: { id: string; name: string; lat: number; lon: number }[]) {
  const primary: typeof stops = []
  const idMapping: Record<string, string> = {}

  for (const stop of stops) {
    const dupIdx = primary.findIndex(
      (p) => haversineMeters(p.lat, p.lon, stop.lat, stop.lon) < 50
    )
    if (dupIdx !== -1) {
      // Keep the one with the longer name
      if (stop.name.length > primary[dupIdx].name.length) {
        const oldId = primary[dupIdx].id
        primary[dupIdx] = stop
        idMapping[oldId] = stop.id
      }
      idMapping[stop.id] = primary[dupIdx].id
    } else {
      primary.push(stop)
      idMapping[stop.id] = stop.id
    }
  }

  return { primary, idMapping }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q')

  try {
    let query = supabase.from('stops').select('*')

    if (q) {
      query = query.ilike('stop_name', `%${q}%`)
    }

    query = query.limit(500) // Fetch more before dedup

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

          const rawStops = filtered
            .map((stop: any) => ({
              id: String(stop.stop_id),
              name: stop.stop_name ?? '',
              lat: parseFloat(stop.stop_lat),
              lon: parseFloat(stop.stop_lon),
            }))
            .filter((s: any) => !isNaN(s.lat) && !isNaN(s.lon) && isValidStopName(s.name))

          const { primary } = deduplicateStops(rawStops)
          const stops = primary.slice(0, 50).map((s) => ({
            id: s.id,
            name: s.name,
            lat: s.lat,
            lon: s.lon,
          }))

          return NextResponse.json({ stops })
        }
      } catch (fsError) {
        console.error('Local CSV fallback failed:', fsError)
      }

      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ stops: [] })
    }

    const rawStops = data
      .map((stop: any) => ({
        id: String(stop.stop_id),
        name: stop.stop_name ?? '',
        lat: parseFloat(stop.stop_lat),
        lon: parseFloat(stop.stop_lon),
      }))
      .filter((s: any) => !isNaN(s.lat) && !isNaN(s.lon) && isValidStopName(s.name))

    const { primary } = deduplicateStops(rawStops)
    const stops = primary.slice(0, 50).map((s) => ({
      id: s.id,
      name: s.name,
      lat: s.lat,
      lon: s.lon,
    }))

    return NextResponse.json({ stops })
  } catch (err) {
    console.error('Unexpected API error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
