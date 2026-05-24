import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import fs from 'fs'
import path from 'path'
import { parse } from 'csv-parse/sync'

export async function GET(request: Request) {
  try {
    const { data, error } = await supabase
      .from('routes')
      .select('*')
      .limit(50)

    if (error) {
      console.warn('Supabase routes fetch failed, falling back to local GTFS CSV:', error.message)
      
      try {
        const filePath = path.join(process.cwd(), 'kigali_gtfs', 'routes.txt')
        if (fs.existsSync(filePath)) {
          const fileContent = fs.readFileSync(filePath, 'utf-8')
          const records = parse(fileContent, { columns: true, skip_empty_lines: true })
          
          const routes = records.slice(0, 50).map((route: any) => ({
            id: route.route_id,
            number: route.route_short_name,
            name: route.route_long_name,
            color: route.route_color ? `#${route.route_color}` : '#00a896',
          }))
          
          return NextResponse.json({ routes })
        }
      } catch (fsError) {
        console.error('Local CSV fallback failed:', fsError)
      }

      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ routes: [] })
    }

    const routes = data.map((route: any) => ({
      id: route.route_id,
      number: route.route_short_name,
      name: route.route_long_name,
      color: route.route_color ? `#${route.route_color}` : '#00a896',
    }))

    return NextResponse.json({ routes })
  } catch (err) {
    console.error('Unexpected API error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
