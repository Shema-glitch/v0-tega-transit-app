import { BusStop, Route } from './types'
import { mockStops, mockRoutes } from './mock-data'

// Client-side fetching wrapper that gracefully falls back to mock data
// if the Supabase GTFS tables are empty (e.g. before the user runs the SQL script)

export async function fetchStops(searchQuery?: string): Promise<BusStop[]> {
  try {
    const url = searchQuery ? `/api/gtfs/stops?q=${encodeURIComponent(searchQuery)}` : '/api/gtfs/stops'
    const res = await fetch(url)
    
    if (!res.ok) throw new Error('API fetch failed')
    
    const data = await res.json()
    
    // Fallback to mock data if DB is empty or search returns nothing and we didn't search
    if (data.stops && data.stops.length > 0) {
      return data.stops
    }
    
    // If we searched but got nothing, return empty
    if (searchQuery) return []
    
    console.log("No GTFS stops found in Supabase, using mock data for UI demo.")
    return mockStops
  } catch (error) {
    console.error("Error fetching stops:", error)
    return mockStops
  }
}

export async function fetchRoutes(): Promise<Route[]> {
  try {
    const res = await fetch('/api/gtfs/routes')
    if (!res.ok) throw new Error('Failed to fetch routes')
    
    const data = await res.json()
    if (data.routes && data.routes.length > 0) {
      return data.routes.map((r: any) => ({
        ...r,
        frequency: '10-15 min',
        confidence: 'high' as any,
        stops: []
      }))
    }
    
    return mockRoutes
  } catch (error) {
    console.error("Error fetching routes:", error)
    return mockRoutes
  }
}

export async function fetchRoutesByStop(stopId: string): Promise<Route[]> {
  try {
    const res = await fetch(`/api/gtfs/stops/${stopId}/routes`)
    if (!res.ok) throw new Error('Failed to fetch routes for stop')
    const data = await res.json()
    if (data.routes && data.routes.length > 0) {
      return data.routes.map((r: any) => ({
        ...r,
        frequency: '10-15 min',
        confidence: 'high' as any,
        stops: []
      }))
    }
    return []
  } catch (error) {
    console.error('Error fetching routes by stop:', error)
    return []
  }
}
