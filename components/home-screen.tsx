'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { RefreshCw, MapPin, Clock, ChevronLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Arrival, BusStop, Bus, ViewMode } from '@/lib/types'
import { 
  mockStops, 
  mockBuses, 
  mockRouteGeometries, 
  mockRoutes,
  getNearbyArrivals, 
  getNearbyStops,
  getArrivalsForStop,
  simulateBusMovement
} from '@/lib/mock-data'
import { BottomSheet } from './bottom-sheet'
import { ETACard, NearbyStopRow, RouteCard } from './cards'
import { ETACardSkeleton, NearbyStopRowSkeleton } from './skeletons'
import { DestinationLabel, ConfidenceIndicator, WalkingDistance } from './transit-ui'
import { TransitMap } from './transit-map'
import { EmptyState, LoadingState, RefreshingIndicator } from './states'

interface HomeScreenProps {
  className?: string
}

export function HomeScreen({ className }: HomeScreenProps) {
  // State
  const [viewMode, setViewMode] = useState<ViewMode>('home')
  const [selectedStop, setSelectedStop] = useState<BusStop | null>(null)
  const [selectedBus, setSelectedBus] = useState<Bus | null>(null)
  const [arrivals, setArrivals] = useState<Arrival[]>([])
  const [nearbyStops, setNearbyStops] = useState<BusStop[]>([])
  const [buses, setBuses] = useState<Bus[]>(mockBuses)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null)

  // Initialize data
  useEffect(() => {
    const loadInitialData = async () => {
      // Simulate initial load
      await new Promise(resolve => setTimeout(resolve, 1500))
      setArrivals(getNearbyArrivals())
      setNearbyStops(getNearbyStops())
      setLastRefresh(new Date())
      setIsLoading(false)
    }

    loadInitialData()

    // Get user location
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          })
        },
        () => {
          // Default to Kigali center if location denied
          setUserLocation({ lat: -1.9403, lng: 30.0618 })
        }
      )
    }
  }, [])

  // Auto-refresh every 15 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      // Simulate bus movement
      setBuses(prev => prev.map(bus => {
        const routeGeometry = mockRouteGeometries.find(r => r.routeId === bus.routeId)
        if (routeGeometry) {
          return simulateBusMovement(bus, routeGeometry)
        }
        return bus
      }))
      setArrivals(getNearbyArrivals())
      setLastRefresh(new Date())
    }, 15000)

    return () => clearInterval(interval)
  }, [])

  // Manual refresh handler
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true)
    await new Promise(resolve => setTimeout(resolve, 1000))
    setArrivals(getNearbyArrivals())
    setNearbyStops(getNearbyStops())
    setLastRefresh(new Date())
    setIsRefreshing(false)
  }, [])

  // Stop selection handler
  const handleStopSelect = useCallback((stop: BusStop) => {
    setSelectedStop(stop)
    setViewMode('stop-detail')
  }, [])

  // Back to home
  const handleBack = useCallback(() => {
    setViewMode('home')
    setSelectedStop(null)
    setSelectedBus(null)
  }, [])

  // Get arrivals for selected stop
  const stopArrivals = selectedStop 
    ? getArrivalsForStop(selectedStop.id) 
    : []

  return (
    <div className={cn('relative h-screen w-full overflow-hidden', className)}>
      {/* Map layer */}
      <TransitMap
        buses={buses}
        stops={mockStops}
        routeGeometries={mockRouteGeometries}
        userLocation={userLocation || undefined}
        selectedStopId={selectedStop?.id}
        onStopClick={handleStopSelect}
        onBusClick={(bus) => setSelectedBus(bus)}
        className="absolute inset-0"
      />

      {/* Bottom sheet */}
      <BottomSheet
        defaultHeight={45}
        minHeight={30}
        maxHeight={85}
      >
        <AnimatePresence mode="wait">
          {viewMode === 'home' ? (
            <HomeContent
              key="home"
              arrivals={arrivals}
              nearbyStops={nearbyStops}
              isLoading={isLoading}
              isRefreshing={isRefreshing}
              lastRefresh={lastRefresh}
              onRefresh={handleRefresh}
              onStopSelect={handleStopSelect}
            />
          ) : viewMode === 'stop-detail' && selectedStop ? (
            <StopDetailContent
              key="stop-detail"
              stop={selectedStop}
              arrivals={stopArrivals}
              onBack={handleBack}
            />
          ) : null}
        </AnimatePresence>
      </BottomSheet>

      {/* Refresh indicator */}
      <RefreshingIndicator isRefreshing={isRefreshing} />
    </div>
  )
}

// Home content component
interface HomeContentProps {
  arrivals: Arrival[]
  nearbyStops: BusStop[]
  isLoading: boolean
  isRefreshing: boolean
  lastRefresh: Date | null
  onRefresh: () => void
  onStopSelect: (stop: BusStop) => void
}

function HomeContent({
  arrivals,
  nearbyStops,
  isLoading,
  isRefreshing,
  lastRefresh,
  onRefresh,
  onStopSelect,
}: HomeContentProps) {
  if (isLoading) {
    return (
      <LoadingState message="Finding nearby buses..." />
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="px-4 pb-8 space-y-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Nearby Buses</h1>
          {lastRefresh && (
            <p className="text-sm text-muted-foreground mt-0.5">
              Updated {formatTimeAgo(lastRefresh)}
            </p>
          )}
        </div>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onRefresh}
          disabled={isRefreshing}
          className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center hover:bg-accent transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn(
            'h-5 w-5 text-foreground',
            isRefreshing && 'animate-spin'
          )} />
        </motion.button>
      </div>

      {/* Upcoming arrivals */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Arriving Soon
        </h2>
        {arrivals.length > 0 ? (
          <div className="space-y-2">
            {arrivals.slice(0, 5).map((arrival, index) => (
              <motion.div
                key={arrival.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                <ETACard
                  arrival={arrival}
                  onPress={() => onStopSelect(arrival.stop)}
                />
              </motion.div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No buses nearby"
            message="Checking for nearby arrivals..."
          />
        )}
      </section>

      {/* Nearby stops */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Nearby Stops
        </h2>
        <div className="space-y-1">
          {nearbyStops.slice(0, 4).map((stop, index) => (
            <motion.div
              key={stop.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 + index * 0.05 }}
            >
              <NearbyStopRow
                stop={stop}
                onPress={() => onStopSelect(stop)}
              />
            </motion.div>
          ))}
        </div>
      </section>

      {/* Routes */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Routes
        </h2>
        <div className="space-y-2">
          {mockRoutes.slice(0, 3).map((route, index) => (
            <motion.div
              key={route.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + index * 0.05 }}
            >
              <RouteCard
                routeName={route.name}
                color={route.color}
                destinations={route.destinations}
              />
            </motion.div>
          ))}
        </div>
      </section>
    </motion.div>
  )
}

// Stop detail content
interface StopDetailContentProps {
  stop: BusStop
  arrivals: Arrival[]
  onBack: () => void
}

function StopDetailContent({ stop, arrivals, onBack }: StopDetailContentProps) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="px-4 pb-8"
    >
      {/* Header with back button */}
      <div className="flex items-center gap-3 mb-6">
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onBack}
          className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center hover:bg-accent transition-colors"
        >
          <ChevronLeft className="h-5 w-5 text-foreground" />
        </motion.button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-foreground text-balance">{stop.name}</h1>
          <WalkingDistance minutes={stop.walkingDistance} meters={stop.walkingMeters} />
        </div>
      </div>

      {/* Arrivals at this stop */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Upcoming Arrivals
          </h2>
        </div>
        {arrivals.length > 0 ? (
          <div className="space-y-2">
            {arrivals.map((arrival, index) => (
              <motion.div
                key={arrival.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                <ETACard arrival={arrival} compact />
              </motion.div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No upcoming buses"
            message="Checking for arrivals at this stop..."
          />
        )}
      </section>
    </motion.div>
  )
}

// Helper to format time ago
function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ago`
}

export default HomeScreen
