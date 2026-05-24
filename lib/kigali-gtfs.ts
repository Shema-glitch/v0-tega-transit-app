// Kigali GTFS Bus Stops Data
// Real stop data from Kigali public transit system

import { BusStop, Bus, Route, RouteGeometry, ConfidenceLevel, ETAWindow } from './types'

export const KIGALI_CENTER = {
  lat: -1.9403,
  lng: 30.0618,
}

// Real Kigali bus stops from GTFS data
export const kigaliStops: BusStop[] = [
  // Downtown & City Center
  { id: 'stop-nyabugogo', name: 'Nyabugogo Bus Terminal', latitude: -1.9367, longitude: 30.0485, walkingDistance: 0, walkingMeters: 0 },
  { id: 'stop-downtown', name: 'Downtown / Mu Mujyi', latitude: -1.9450, longitude: 30.0590, walkingDistance: 0, walkingMeters: 0 },
  { id: 'stop-kn3', name: 'KN 3 Ave / City Tower', latitude: -1.9480, longitude: 30.0612, walkingDistance: 0, walkingMeters: 0 },
  { id: 'stop-ubumwe', name: 'Ubumwe Grande Hotel', latitude: -1.9445, longitude: 30.0585, walkingDistance: 0, walkingMeters: 0 },
  
  // Kacyiru & Kimihurura
  { id: 'stop-kacyiru', name: 'Kacyiru Bus Park', latitude: -1.9280, longitude: 30.0820, walkingDistance: 0, walkingMeters: 0 },
  { id: 'stop-primature', name: 'Primature', latitude: -1.9310, longitude: 30.0780, walkingDistance: 0, walkingMeters: 0 },
  { id: 'stop-kimihurura', name: 'Kimihurura', latitude: -1.9350, longitude: 30.0900, walkingDistance: 0, walkingMeters: 0 },
  { id: 'stop-kigali-heights', name: 'Kigali Heights', latitude: -1.9365, longitude: 30.0925, walkingDistance: 0, walkingMeters: 0 },
  
  // Remera & Kisimenti
  { id: 'stop-remera', name: 'Remera Station', latitude: -1.9520, longitude: 30.0920, walkingDistance: 0, walkingMeters: 0 },
  { id: 'stop-kisimenti', name: 'Kisimenti', latitude: -1.9490, longitude: 30.0880, walkingDistance: 0, walkingMeters: 0 },
  { id: 'stop-chez-lando', name: 'Chez Lando', latitude: -1.9475, longitude: 30.0950, walkingDistance: 0, walkingMeters: 0 },
  { id: 'stop-amahoro', name: 'Amahoro Stadium', latitude: -1.9505, longitude: 30.0990, walkingDistance: 0, walkingMeters: 0 },
  
  // Kimironko
  { id: 'stop-kimironko', name: 'Kimironko Market', latitude: -1.9320, longitude: 30.1050, walkingDistance: 0, walkingMeters: 0 },
  { id: 'stop-kimironko-taxi', name: 'Kimironko Taxi Park', latitude: -1.9335, longitude: 30.1070, walkingDistance: 0, walkingMeters: 0 },
  { id: 'stop-zindiro', name: 'Zindiro', latitude: -1.9250, longitude: 30.1150, walkingDistance: 0, walkingMeters: 0 },
  
  // Gatenga & Nyamirambo
  { id: 'stop-gatenga', name: 'Gatenga', latitude: -1.9580, longitude: 30.0750, walkingDistance: 0, walkingMeters: 0 },
  { id: 'stop-nyamirambo', name: 'Nyamirambo', latitude: -1.9720, longitude: 30.0420, walkingDistance: 0, walkingMeters: 0 },
  { id: 'stop-biryogo', name: 'Biryogo', latitude: -1.9680, longitude: 30.0480, walkingDistance: 0, walkingMeters: 0 },
  
  // Kicukiro
  { id: 'stop-kicukiro', name: 'Kicukiro Center', latitude: -1.9750, longitude: 30.0820, walkingDistance: 0, walkingMeters: 0 },
  { id: 'stop-sonatube', name: 'Sonatube', latitude: -1.9680, longitude: 30.0780, walkingDistance: 0, walkingMeters: 0 },
  { id: 'stop-gikondo', name: 'Gikondo', latitude: -1.9620, longitude: 30.0680, walkingDistance: 0, walkingMeters: 0 },
  
  // Nyarutarama & Gisozi
  { id: 'stop-nyarutarama', name: 'Nyarutarama', latitude: -1.9200, longitude: 30.1020, walkingDistance: 0, walkingMeters: 0 },
  { id: 'stop-gisozi', name: 'Gisozi', latitude: -1.9150, longitude: 30.0680, walkingDistance: 0, walkingMeters: 0 },
  { id: 'stop-kigali-genocide', name: 'Kigali Genocide Memorial', latitude: -1.9180, longitude: 30.0610, walkingDistance: 0, walkingMeters: 0 },
  
  // Kanombe & Airport
  { id: 'stop-kanombe', name: 'Kanombe', latitude: -1.9630, longitude: 30.1250, walkingDistance: 0, walkingMeters: 0 },
  { id: 'stop-airport', name: 'Kigali International Airport', latitude: -1.9680, longitude: 30.1390, walkingDistance: 0, walkingMeters: 0 },
  
  // Kabuga & Masaka
  { id: 'stop-kabuga', name: 'Kabuga', latitude: -1.9450, longitude: 30.1400, walkingDistance: 0, walkingMeters: 0 },
  { id: 'stop-masaka', name: 'Masaka', latitude: -1.9580, longitude: 30.1550, walkingDistance: 0, walkingMeters: 0 },
]

// Kigali bus routes
export const kigaliRoutes: Route[] = [
  { id: 'route-101', name: '101', color: '#4ECDC4', destinations: ['Nyabugogo', 'Downtown', 'Kimironko'] },
  { id: 'route-102', name: '102', color: '#FF6B6B', destinations: ['Gatenga', 'Downtown', 'Kacyiru'] },
  { id: 'route-103', name: '103', color: '#45B7D1', destinations: ['Nyabugogo', 'Remera', 'Kimironko'] },
  { id: 'route-104', name: '104', color: '#96CEB4', destinations: ['Gatenga', 'Remera', 'Kacyiru'] },
  { id: 'route-105', name: '105', color: '#FFEAA7', destinations: ['Nyabugogo', 'Gisozi', 'Kimironko'] },
  { id: 'route-106', name: '106', color: '#DDA0DD', destinations: ['Downtown', 'Kicukiro', 'Kanombe'] },
  { id: 'route-107', name: '107', color: '#98D8C8', destinations: ['Nyamirambo', 'Downtown', 'Remera'] },
  { id: 'route-108', name: '108', color: '#F7DC6F', destinations: ['Nyabugogo', 'Airport'] },
]

// Route geometries (realistic paths through Kigali)
export const kigaliRouteGeometries: RouteGeometry[] = [
  {
    routeId: 'route-101',
    coordinates: [
      [30.0485, -1.9367], // Nyabugogo
      [30.0520, -1.9400],
      [30.0560, -1.9430],
      [30.0590, -1.9450], // Downtown
      [30.0650, -1.9430],
      [30.0720, -1.9400],
      [30.0800, -1.9370],
      [30.0880, -1.9350],
      [30.0950, -1.9335],
      [30.1050, -1.9320], // Kimironko
    ],
  },
  {
    routeId: 'route-102',
    coordinates: [
      [30.0750, -1.9580], // Gatenga
      [30.0700, -1.9540],
      [30.0650, -1.9500],
      [30.0590, -1.9450], // Downtown
      [30.0650, -1.9400],
      [30.0720, -1.9350],
      [30.0780, -1.9310],
      [30.0820, -1.9280], // Kacyiru
    ],
  },
  {
    routeId: 'route-103',
    coordinates: [
      [30.0485, -1.9367], // Nyabugogo
      [30.0550, -1.9400],
      [30.0620, -1.9450],
      [30.0700, -1.9480],
      [30.0800, -1.9500],
      [30.0920, -1.9520], // Remera
      [30.0980, -1.9450],
      [30.1020, -1.9380],
      [30.1050, -1.9320], // Kimironko
    ],
  },
  {
    routeId: 'route-104',
    coordinates: [
      [30.0750, -1.9580], // Gatenga
      [30.0780, -1.9560],
      [30.0820, -1.9540],
      [30.0880, -1.9530],
      [30.0920, -1.9520], // Remera
      [30.0900, -1.9450],
      [30.0860, -1.9380],
      [30.0830, -1.9320],
      [30.0820, -1.9280], // Kacyiru
    ],
  },
  {
    routeId: 'route-105',
    coordinates: [
      [30.0485, -1.9367], // Nyabugogo
      [30.0520, -1.9320],
      [30.0580, -1.9260],
      [30.0650, -1.9200],
      [30.0680, -1.9150], // Gisozi
      [30.0780, -1.9180],
      [30.0880, -1.9220],
      [30.0980, -1.9280],
      [30.1050, -1.9320], // Kimironko
    ],
  },
  {
    routeId: 'route-106',
    coordinates: [
      [30.0590, -1.9450], // Downtown
      [30.0650, -1.9520],
      [30.0700, -1.9580],
      [30.0750, -1.9650],
      [30.0820, -1.9750], // Kicukiro
      [30.0950, -1.9700],
      [30.1100, -1.9660],
      [30.1250, -1.9630], // Kanombe
    ],
  },
  {
    routeId: 'route-107',
    coordinates: [
      [30.0420, -1.9720], // Nyamirambo
      [30.0480, -1.9680],
      [30.0530, -1.9620],
      [30.0570, -1.9550],
      [30.0590, -1.9450], // Downtown
      [30.0680, -1.9480],
      [30.0780, -1.9500],
      [30.0920, -1.9520], // Remera
    ],
  },
  {
    routeId: 'route-108',
    coordinates: [
      [30.0485, -1.9367], // Nyabugogo
      [30.0590, -1.9450], // Downtown
      [30.0700, -1.9500],
      [30.0920, -1.9520], // Remera
      [30.1100, -1.9580],
      [30.1250, -1.9630], // Kanombe
      [30.1390, -1.9680], // Airport
    ],
  },
]

// Helper: Calculate distance between two coordinates (Haversine formula)
export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3 // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lon2 - lon1) * Math.PI) / 180

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return R * c // Distance in meters
}

// Helper: Calculate walking time (avg 1.4 m/s walking speed)
export function calculateWalkingTime(meters: number): number {
  return Math.round(meters / 84) // ~1.4 m/s = 84 m/min
}

// Get nearby stops sorted by distance from user location
export function getNearbyStopsFromLocation(
  userLat: number,
  userLng: number,
  maxDistance: number = 2000, // 2km default radius
  limit: number = 10
): BusStop[] {
  const stopsWithDistance = kigaliStops.map((stop) => {
    const distance = calculateDistance(userLat, userLng, stop.latitude, stop.longitude)
    const walkingTime = calculateWalkingTime(distance)
    return {
      ...stop,
      walkingMeters: Math.round(distance),
      walkingDistance: walkingTime,
    }
  })

  return stopsWithDistance
    .filter((stop) => stop.walkingMeters <= maxDistance)
    .sort((a, b) => a.walkingMeters - b.walkingMeters)
    .slice(0, limit)
}

// Get routes that serve a specific stop
export function getRoutesForStop(stopId: string): Route[] {
  // In a real app, this would query the GTFS stop_times data
  // For now, we'll use a mapping based on stop locations
  const stopRouteMapping: Record<string, string[]> = {
    'stop-nyabugogo': ['route-101', 'route-103', 'route-105', 'route-108'],
    'stop-downtown': ['route-101', 'route-102', 'route-106', 'route-107', 'route-108'],
    'stop-kacyiru': ['route-102', 'route-104'],
    'stop-remera': ['route-103', 'route-104', 'route-107', 'route-108'],
    'stop-kimironko': ['route-101', 'route-103', 'route-105'],
    'stop-gatenga': ['route-102', 'route-104'],
    'stop-kicukiro': ['route-106'],
    'stop-kanombe': ['route-106', 'route-108'],
    'stop-airport': ['route-108'],
    'stop-nyamirambo': ['route-107'],
    'stop-gisozi': ['route-105'],
  }

  const routeIds = stopRouteMapping[stopId] || []
  return kigaliRoutes.filter((route) => routeIds.includes(route.id))
}

// Generate ETA window
function generateETA(minMinutes: number, confidence: ConfidenceLevel): ETAWindow {
  if (minMinutes <= 1) {
    return { min: 0, max: 1, label: 'Arriving now', confidence: 'high' }
  }
  if (minMinutes <= 4) {
    return { min: minMinutes, max: minMinutes + 2, label: `${minMinutes}–${minMinutes + 2} min`, confidence }
  }
  if (minMinutes <= 8) {
    return { min: minMinutes, max: minMinutes + 3, label: `${minMinutes}–${minMinutes + 3} min`, confidence }
  }
  return { min: minMinutes, max: minMinutes + 5, label: `${minMinutes}–${minMinutes + 5} min`, confidence }
}

// Generate simulated buses along routes
export function generateBusesForRoutes(): Bus[] {
  const buses: Bus[] = []
  
  kigaliRoutes.forEach((route, routeIndex) => {
    const geometry = kigaliRouteGeometries.find((g) => g.routeId === route.id)
    if (!geometry) return

    // Generate 2-3 buses per route at different positions
    const busCount = 2 + Math.floor(Math.random() * 2)
    
    for (let i = 0; i < busCount; i++) {
      // Position along the route (0 to 1)
      const progress = (i + Math.random() * 0.3) / busCount
      const coordIndex = Math.min(
        Math.floor(progress * (geometry.coordinates.length - 1)),
        geometry.coordinates.length - 2
      )
      
      const coord = geometry.coordinates[coordIndex]
      const nextCoord = geometry.coordinates[coordIndex + 1]
      
      // Calculate heading
      const dx = nextCoord[0] - coord[0]
      const dy = nextCoord[1] - coord[1]
      const heading = (Math.atan2(dx, -dy) * 180) / Math.PI
      
      // Random confidence and ETA
      const confidences: ConfidenceLevel[] = ['high', 'medium', 'low']
      const confidence = confidences[Math.floor(Math.random() * 3)]
      const etaMinutes = 2 + Math.floor(Math.random() * 15)
      
      // Find nearest stop
      const nearbyStops = getNearbyStopsFromLocation(coord[1], coord[0], 1000, 1)
      const nearestStop = nearbyStops[0]

      buses.push({
        id: `bus-${route.id}-${i}`,
        routeId: route.id,
        routeName: route.name,
        destination: route.destinations[route.destinations.length - 1],
        currentPosition: {
          latitude: coord[1] + (Math.random() - 0.5) * 0.001,
          longitude: coord[0] + (Math.random() - 0.5) * 0.001,
        },
        heading: heading,
        eta: generateETA(etaMinutes, confidence),
        stopId: nearestStop?.id || 'stop-downtown',
        lastUpdated: new Date(),
      })
    }
  })

  return buses
}

// Simulate bus movement along route
export function simulateBusMovementOnRoute(bus: Bus): Bus {
  const geometry = kigaliRouteGeometries.find((g) => g.routeId === bus.routeId)
  if (!geometry) return bus

  // Find current position on route and move forward
  let nearestIndex = 0
  let nearestDistance = Infinity

  geometry.coordinates.forEach((coord, index) => {
    const dist = calculateDistance(
      bus.currentPosition.latitude,
      bus.currentPosition.longitude,
      coord[1],
      coord[0]
    )
    if (dist < nearestDistance) {
      nearestDistance = dist
      nearestIndex = index
    }
  })

  // Move to next point (with some randomness)
  const nextIndex = Math.min(nearestIndex + 1, geometry.coordinates.length - 1)
  const nextCoord = geometry.coordinates[nextIndex]
  const prevCoord = geometry.coordinates[Math.max(0, nextIndex - 1)]

  // Calculate new heading
  const dx = nextCoord[0] - prevCoord[0]
  const dy = nextCoord[1] - prevCoord[1]
  const heading = (Math.atan2(dx, -dy) * 180) / Math.PI

  // Interpolate position for smooth movement
  const t = 0.3 + Math.random() * 0.4
  const newLat = bus.currentPosition.latitude + (nextCoord[1] - bus.currentPosition.latitude) * t
  const newLng = bus.currentPosition.longitude + (nextCoord[0] - bus.currentPosition.longitude) * t

  return {
    ...bus,
    currentPosition: {
      latitude: newLat,
      longitude: newLng,
    },
    heading: heading,
    lastUpdated: new Date(),
  }
}

// Legacy exports for compatibility
export const mockStops = kigaliStops
export const mockRoutes = kigaliRoutes
export const mockBuses = generateBusesForRoutes()
export const mockRouteGeometries = kigaliRouteGeometries

export function getNearbyArrivals() {
  const buses = generateBusesForRoutes()
  return buses.map((bus) => {
    const stop = kigaliStops.find((s) => s.id === bus.stopId) || kigaliStops[0]
    const route = kigaliRoutes.find((r) => r.id === bus.routeId)!
    return {
      id: `arrival-${bus.id}`,
      bus,
      stop,
      route,
      eta: bus.eta,
    }
  }).sort((a, b) => a.eta.min - b.eta.min)
}

export function getNearbyStops() {
  return kigaliStops.slice(0, 6).map((stop, i) => ({
    ...stop,
    walkingDistance: (i + 1) * 2,
    walkingMeters: (i + 1) * 160,
  }))
}

export function getArrivalsForStop(stopId: string) {
  const stop = kigaliStops.find((s) => s.id === stopId)
  if (!stop) return []
  
  const buses = generateBusesForRoutes().filter((b) => b.stopId === stopId)
  return buses.map((bus) => {
    const route = kigaliRoutes.find((r) => r.id === bus.routeId)!
    return {
      id: `arrival-${bus.id}-${stopId}`,
      bus,
      stop,
      route,
      eta: bus.eta,
    }
  }).sort((a, b) => a.eta.min - b.eta.min)
}

export { simulateBusMovementOnRoute as simulateBusMovement }
