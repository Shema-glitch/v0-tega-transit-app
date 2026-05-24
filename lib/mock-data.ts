import { BusStop, Bus, Route, Arrival, ETAWindow, RouteGeometry, ConfidenceLevel } from './types'

// Kigali center coordinates
export const KIGALI_CENTER = {
  lat: -1.9403,
  lng: 30.0618,
}

// Realistic Kigali bus stops
export const mockStops: BusStop[] = [
  {
    id: 'stop-1',
    name: 'Nyabugogo Main Terminal',
    latitude: -1.9367,
    longitude: 30.0485,
    walkingDistance: 3,
    walkingMeters: 240,
  },
  {
    id: 'stop-2',
    name: 'Gatenga Stop',
    latitude: -1.9580,
    longitude: 30.0750,
    walkingDistance: 5,
    walkingMeters: 400,
  },
  {
    id: 'stop-3',
    name: 'Downtown / Mu Mujyi',
    latitude: -1.9450,
    longitude: 30.0590,
    walkingDistance: 2,
    walkingMeters: 160,
  },
  {
    id: 'stop-4',
    name: 'Kacyiru Bus Park',
    latitude: -1.9280,
    longitude: 30.0820,
    walkingDistance: 7,
    walkingMeters: 560,
  },
  {
    id: 'stop-5',
    name: 'Kimironko Market',
    latitude: -1.9320,
    longitude: 30.1050,
    walkingDistance: 12,
    walkingMeters: 960,
  },
  {
    id: 'stop-6',
    name: 'Remera Station',
    latitude: -1.9520,
    longitude: 30.0920,
    walkingDistance: 8,
    walkingMeters: 640,
  },
]

// Routes
export const mockRoutes: Route[] = [
  {
    id: 'route-101',
    name: '101',
    color: '#4ECDC4',
    destinations: ['Nyabugogo', 'Downtown', 'Kimironko'],
  },
  {
    id: 'route-102',
    name: '102',
    color: '#FF6B6B',
    destinations: ['Gatenga', 'Downtown', 'Kacyiru'],
  },
  {
    id: 'route-103',
    name: '103',
    color: '#45B7D1',
    destinations: ['Nyabugogo', 'Remera', 'Kimironko'],
  },
  {
    id: 'route-104',
    name: '104',
    color: '#96CEB4',
    destinations: ['Gatenga', 'Remera', 'Kacyiru'],
  },
]

// Helper to generate ETA windows
function generateETA(minMinutes: number, confidence: ConfidenceLevel): ETAWindow {
  const ranges: Record<string, { range: number; label: string }> = {
    arriving: { range: 1, label: 'Arriving now' },
    soon: { range: 2, label: `${minMinutes}–${minMinutes + 2} min` },
    medium: { range: 3, label: `${minMinutes}–${minMinutes + 3} min` },
    later: { range: 5, label: `${minMinutes}–${minMinutes + 5} min` },
  }

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

// Mock buses with positions
export const mockBuses: Bus[] = [
  {
    id: 'bus-1',
    routeId: 'route-101',
    routeName: '101',
    destination: 'Nyabugogo',
    currentPosition: { latitude: -1.9420, longitude: 30.0550 },
    heading: 315,
    eta: generateETA(3, 'high'),
    stopId: 'stop-3',
    lastUpdated: new Date(),
  },
  {
    id: 'bus-2',
    routeId: 'route-102',
    routeName: '102',
    destination: 'Gatenga',
    currentPosition: { latitude: -1.9500, longitude: 30.0680 },
    heading: 180,
    eta: generateETA(6, 'medium'),
    stopId: 'stop-3',
    lastUpdated: new Date(),
  },
  {
    id: 'bus-3',
    routeId: 'route-103',
    routeName: '103',
    destination: 'Kimironko',
    currentPosition: { latitude: -1.9380, longitude: 30.0620 },
    heading: 90,
    eta: generateETA(2, 'high'),
    stopId: 'stop-3',
    lastUpdated: new Date(),
  },
  {
    id: 'bus-4',
    routeId: 'route-101',
    routeName: '101',
    destination: 'Kimironko',
    currentPosition: { latitude: -1.9350, longitude: 30.0500 },
    heading: 45,
    eta: generateETA(8, 'low'),
    stopId: 'stop-1',
    lastUpdated: new Date(),
  },
  {
    id: 'bus-5',
    routeId: 'route-104',
    routeName: '104',
    destination: 'Kacyiru',
    currentPosition: { latitude: -1.9550, longitude: 30.0800 },
    heading: 0,
    eta: generateETA(12, 'medium'),
    stopId: 'stop-2',
    lastUpdated: new Date(),
  },
]

// Route geometries (simplified paths)
export const mockRouteGeometries: RouteGeometry[] = [
  {
    routeId: 'route-101',
    coordinates: [
      [30.0485, -1.9367], // Nyabugogo
      [30.0520, -1.9400],
      [30.0590, -1.9450], // Downtown
      [30.0700, -1.9420],
      [30.0850, -1.9380],
      [30.1050, -1.9320], // Kimironko
    ],
  },
  {
    routeId: 'route-102',
    coordinates: [
      [30.0750, -1.9580], // Gatenga
      [30.0680, -1.9520],
      [30.0590, -1.9450], // Downtown
      [30.0650, -1.9380],
      [30.0750, -1.9320],
      [30.0820, -1.9280], // Kacyiru
    ],
  },
  {
    routeId: 'route-103',
    coordinates: [
      [30.0485, -1.9367], // Nyabugogo
      [30.0580, -1.9420],
      [30.0700, -1.9480],
      [30.0920, -1.9520], // Remera
      [30.1000, -1.9420],
      [30.1050, -1.9320], // Kimironko
    ],
  },
  {
    routeId: 'route-104',
    coordinates: [
      [30.0750, -1.9580], // Gatenga
      [30.0800, -1.9550],
      [30.0920, -1.9520], // Remera
      [30.0880, -1.9400],
      [30.0820, -1.9280], // Kacyiru
    ],
  },
]

// Generate arrivals from buses and stops
export function getArrivalsForStop(stopId: string): Arrival[] {
  const stop = mockStops.find(s => s.id === stopId)
  if (!stop) return []

  return mockBuses
    .filter(bus => bus.stopId === stopId)
    .map(bus => {
      const route = mockRoutes.find(r => r.id === bus.routeId)!
      return {
        id: `arrival-${bus.id}-${stopId}`,
        bus,
        stop,
        route,
        eta: bus.eta,
      }
    })
    .sort((a, b) => a.eta.min - b.eta.min)
}

// Get nearby arrivals (all arrivals sorted by ETA)
export function getNearbyArrivals(): Arrival[] {
  const arrivals: Arrival[] = []
  
  mockBuses.forEach(bus => {
    const stop = mockStops.find(s => s.id === bus.stopId)
    const route = mockRoutes.find(r => r.id === bus.routeId)
    if (stop && route) {
      arrivals.push({
        id: `arrival-${bus.id}-${stop.id}`,
        bus,
        stop,
        route,
        eta: bus.eta,
      })
    }
  })

  return arrivals.sort((a, b) => a.eta.min - b.eta.min)
}

// Get stops sorted by walking distance
export function getNearbyStops(): BusStop[] {
  return [...mockStops].sort((a, b) => a.walkingDistance - b.walkingDistance)
}

// Simulate bus movement (for animation)
export function simulateBusMovement(bus: Bus, routeGeometry: RouteGeometry): Bus {
  const coords = routeGeometry.coordinates
  const randomIndex = Math.floor(Math.random() * (coords.length - 1))
  const nextCoord = coords[randomIndex]
  const prevCoord = coords[Math.max(0, randomIndex - 1)]
  
  // Calculate heading
  const dx = nextCoord[0] - prevCoord[0]
  const dy = nextCoord[1] - prevCoord[1]
  const heading = (Math.atan2(dx, -dy) * 180) / Math.PI

  return {
    ...bus,
    currentPosition: {
      latitude: nextCoord[1] + (Math.random() - 0.5) * 0.002,
      longitude: nextCoord[0] + (Math.random() - 0.5) * 0.002,
    },
    heading: heading,
    lastUpdated: new Date(),
  }
}
