// Types for the BusGo Track transit app

export type ConfidenceLevel = 'high' | 'medium' | 'low'

export interface ETAWindow {
  min: number
  max: number
  label: string
  confidence: ConfidenceLevel
}

export interface BusStop {
  id: string
  name: string
  latitude: number
  longitude: number
  walkingDistance: number // in minutes
  walkingMeters: number
}

export interface Route {
  id: string
  name: string
  color: string
  destinations: string[]
}

export interface Bus {
  id: string
  routeId: string
  routeName: string
  destination: string
  currentPosition: {
    latitude: number
    longitude: number
  }
  heading: number // degrees
  eta: ETAWindow
  stopId: string
  lastUpdated: Date
}

export interface Arrival {
  id: string
  bus: Bus
  stop: BusStop
  route: Route
  eta: ETAWindow
}

export interface RouteGeometry {
  routeId: string
  coordinates: [number, number][] // [lng, lat]
}

// App state types
export type ViewMode = 'home' | 'stop-detail' | 'route-detail'

export interface AppState {
  viewMode: ViewMode
  selectedStopId: string | null
  selectedRouteId: string | null
  isLoading: boolean
  isRefreshing: boolean
  hasError: boolean
  lastRefresh: Date | null
}
