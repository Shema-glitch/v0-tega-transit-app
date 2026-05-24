'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { RefreshCw, MapPin, Clock, ChevronLeft, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Arrival, BusStop, Bus, ViewMode, Route } from '@/lib/types'
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
import { WalkingDistance, RoutePill, ConfidenceIndicator, ETADisplay } from './transit-ui'
import { TransitMap } from './transit-map'
import { EmptyState, LoadingState, RefreshingIndicator, SplashScreen } from './states'

// Hook to detect screen size
function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    const media = window.matchMedia(query)
    if (media.matches !== matches) {
      setMatches(media.matches)
    }
    const listener = () => setMatches(media.matches)
    media.addEventListener('change', listener)
    return () => media.removeEventListener('change', listener)
  }, [matches, query])

  return matches
}

export function ResponsiveApp() {
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const isTablet = useMediaQuery('(min-width: 768px)')
  const [showSplash, setShowSplash] = useState(true)
  
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
      await new Promise(resolve => setTimeout(resolve, 2000))
      setArrivals(getNearbyArrivals())
      setNearbyStops(getNearbyStops())
      setLastRefresh(new Date())
      setIsLoading(false)
      
      // Hide splash after data loads
      setTimeout(() => setShowSplash(false), 500)
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
          setUserLocation({ lat: -1.9403, lng: 30.0618 })
        }
      )
    }
  }, [])

  // Auto-refresh every 15 seconds
  useEffect(() => {
    const interval = setInterval(() => {
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

  const stopArrivals = selectedStop 
    ? getArrivalsForStop(selectedStop.id) 
    : []

  // Render desktop layout
  if (isDesktop) {
    return (
      <>
        <AnimatePresence>
          {showSplash && <SplashScreen />}
        </AnimatePresence>
        <DesktopLayout
          arrivals={arrivals}
          nearbyStops={nearbyStops}
          buses={buses}
          isLoading={isLoading}
          isRefreshing={isRefreshing}
          lastRefresh={lastRefresh}
          userLocation={userLocation}
          selectedStop={selectedStop}
          stopArrivals={stopArrivals}
          onRefresh={handleRefresh}
          onStopSelect={handleStopSelect}
          onBack={handleBack}
        />
      </>
    )
  }

  // Render tablet layout
  if (isTablet) {
    return (
      <>
        <AnimatePresence>
          {showSplash && <SplashScreen />}
        </AnimatePresence>
        <TabletLayout
          arrivals={arrivals}
          nearbyStops={nearbyStops}
          buses={buses}
          isLoading={isLoading}
          isRefreshing={isRefreshing}
          lastRefresh={lastRefresh}
          userLocation={userLocation}
          selectedStop={selectedStop}
          stopArrivals={stopArrivals}
          onRefresh={handleRefresh}
          onStopSelect={handleStopSelect}
          onBack={handleBack}
        />
      </>
    )
  }

  // Render mobile layout (default)
  return (
    <>
      <AnimatePresence>
        {showSplash && <SplashScreen />}
      </AnimatePresence>
      <MobileLayout
        arrivals={arrivals}
        nearbyStops={nearbyStops}
        buses={buses}
        isLoading={isLoading}
        isRefreshing={isRefreshing}
        lastRefresh={lastRefresh}
        userLocation={userLocation}
        selectedStop={selectedStop}
        stopArrivals={stopArrivals}
        onRefresh={handleRefresh}
        onStopSelect={handleStopSelect}
        onBack={handleBack}
      />
    </>
  )
}

// Shared props interface
interface LayoutProps {
  arrivals: Arrival[]
  nearbyStops: BusStop[]
  buses: Bus[]
  isLoading: boolean
  isRefreshing: boolean
  lastRefresh: Date | null
  userLocation: { lat: number; lng: number } | null
  selectedStop: BusStop | null
  stopArrivals: Arrival[]
  onRefresh: () => void
  onStopSelect: (stop: BusStop) => void
  onBack: () => void
}

// Desktop layout - side panel instead of bottom sheet
function DesktopLayout({
  arrivals,
  nearbyStops,
  buses,
  isLoading,
  isRefreshing,
  lastRefresh,
  userLocation,
  selectedStop,
  stopArrivals,
  onRefresh,
  onStopSelect,
  onBack,
}: LayoutProps) {
  return (
    <div className="h-screen w-full flex">
      {/* Side panel */}
      <motion.aside
        initial={{ x: -400 }}
        animate={{ x: 0 }}
        className="w-[420px] h-full bg-background border-r border-border flex flex-col shrink-0"
      >
        {/* Header */}
        <div className="p-6 border-b border-border">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Tega</h1>
              <p className="text-sm text-muted-foreground">Bus tracking for Kigali</p>
            </div>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={onRefresh}
              disabled={isRefreshing}
              className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center hover:bg-accent transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn('h-5 w-5 text-foreground', isRefreshing && 'animate-spin')} />
            </motion.button>
          </div>
          {lastRefresh && (
            <p className="text-xs text-muted-foreground mt-2">
              Updated {formatTimeAgo(lastRefresh)}
            </p>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <AnimatePresence mode="wait">
            {selectedStop ? (
              <StopDetailPanel
                key="stop-detail"
                stop={selectedStop}
                arrivals={stopArrivals}
                onBack={onBack}
              />
            ) : (
              <HomePanel
                key="home"
                arrivals={arrivals}
                nearbyStops={nearbyStops}
                isLoading={isLoading}
                onStopSelect={onStopSelect}
              />
            )}
          </AnimatePresence>
        </div>
      </motion.aside>

      {/* Map */}
      <div className="flex-1 relative">
        <TransitMap
          buses={buses}
          stops={mockStops}
          routeGeometries={mockRouteGeometries}
          userLocation={userLocation || undefined}
          selectedStopId={selectedStop?.id}
          onStopClick={onStopSelect}
          className="absolute inset-0"
        />
      </div>

      <RefreshingIndicator isRefreshing={isRefreshing} />
    </div>
  )
}

// Tablet layout - narrower side panel
function TabletLayout({
  arrivals,
  nearbyStops,
  buses,
  isLoading,
  isRefreshing,
  lastRefresh,
  userLocation,
  selectedStop,
  stopArrivals,
  onRefresh,
  onStopSelect,
  onBack,
}: LayoutProps) {
  return (
    <div className="h-screen w-full flex">
      {/* Side panel */}
      <motion.aside
        initial={{ x: -360 }}
        animate={{ x: 0 }}
        className="w-[360px] h-full bg-background border-r border-border flex flex-col shrink-0"
      >
        {/* Header */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-foreground">Tega</h1>
              <p className="text-xs text-muted-foreground">Bus tracking for Kigali</p>
            </div>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={onRefresh}
              disabled={isRefreshing}
              className="h-9 w-9 rounded-full bg-secondary flex items-center justify-center hover:bg-accent transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn('h-4 w-4 text-foreground', isRefreshing && 'animate-spin')} />
            </motion.button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <AnimatePresence mode="wait">
            {selectedStop ? (
              <StopDetailPanel
                key="stop-detail"
                stop={selectedStop}
                arrivals={stopArrivals}
                onBack={onBack}
                compact
              />
            ) : (
              <HomePanel
                key="home"
                arrivals={arrivals}
                nearbyStops={nearbyStops}
                isLoading={isLoading}
                onStopSelect={onStopSelect}
                compact
              />
            )}
          </AnimatePresence>
        </div>
      </motion.aside>

      {/* Map */}
      <div className="flex-1 relative">
        <TransitMap
          buses={buses}
          stops={mockStops}
          routeGeometries={mockRouteGeometries}
          userLocation={userLocation || undefined}
          selectedStopId={selectedStop?.id}
          onStopClick={onStopSelect}
          className="absolute inset-0"
        />
      </div>

      <RefreshingIndicator isRefreshing={isRefreshing} />
    </div>
  )
}

// Mobile layout - bottom sheet
function MobileLayout({
  arrivals,
  nearbyStops,
  buses,
  isLoading,
  isRefreshing,
  lastRefresh,
  userLocation,
  selectedStop,
  stopArrivals,
  onRefresh,
  onStopSelect,
  onBack,
}: LayoutProps) {
  return (
    <div className="relative h-screen w-full overflow-hidden">
      {/* Map layer */}
      <TransitMap
        buses={buses}
        stops={mockStops}
        routeGeometries={mockRouteGeometries}
        userLocation={userLocation || undefined}
        selectedStopId={selectedStop?.id}
        onStopClick={onStopSelect}
        className="absolute inset-0"
      />

      {/* Bottom sheet */}
      <BottomSheet
        defaultHeight={45}
        minHeight={30}
        maxHeight={85}
      >
        <AnimatePresence mode="wait">
          {selectedStop ? (
            <StopDetailPanel
              key="stop-detail"
              stop={selectedStop}
              arrivals={stopArrivals}
              onBack={onBack}
            />
          ) : (
            <MobileHomeContent
              key="home"
              arrivals={arrivals}
              nearbyStops={nearbyStops}
              isLoading={isLoading}
              isRefreshing={isRefreshing}
              lastRefresh={lastRefresh}
              onRefresh={onRefresh}
              onStopSelect={onStopSelect}
            />
          )}
        </AnimatePresence>
      </BottomSheet>

      <RefreshingIndicator isRefreshing={isRefreshing} />
    </div>
  )
}

// Home panel for desktop/tablet
interface HomePanelProps {
  arrivals: Arrival[]
  nearbyStops: BusStop[]
  isLoading: boolean
  onStopSelect: (stop: BusStop) => void
  compact?: boolean
}

function HomePanel({ arrivals, nearbyStops, isLoading, onStopSelect, compact }: HomePanelProps) {
  if (isLoading) {
    return <LoadingState />
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className={cn('space-y-6', compact ? 'p-4' : 'p-6')}
    >
      {/* Arrivals */}
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
                  compact={compact}
                />
              </motion.div>
            ))}
          </div>
        ) : (
          <EmptyState title="No buses nearby" message="Checking for nearby arrivals..." />
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
              <NearbyStopRow stop={stop} onPress={() => onStopSelect(stop)} />
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
          {mockRoutes.map((route, index) => (
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

// Stop detail panel
interface StopDetailPanelProps {
  stop: BusStop
  arrivals: Arrival[]
  onBack: () => void
  compact?: boolean
}

function StopDetailPanel({ stop, arrivals, onBack, compact }: StopDetailPanelProps) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className={cn(compact ? 'p-4' : 'p-6')}
    >
      {/* Header */}
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
          <h2 className={cn('font-bold text-foreground text-balance', compact ? 'text-lg' : 'text-xl')}>
            {stop.name}
          </h2>
          <WalkingDistance minutes={stop.walkingDistance} meters={stop.walkingMeters} />
        </div>
      </div>

      {/* Arrivals */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Upcoming Arrivals
          </h3>
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
          <EmptyState title="No upcoming buses" message="Checking for arrivals at this stop..." />
        )}
      </section>
    </motion.div>
  )
}

// Mobile home content
interface MobileHomeContentProps {
  arrivals: Arrival[]
  nearbyStops: BusStop[]
  isLoading: boolean
  isRefreshing: boolean
  lastRefresh: Date | null
  onRefresh: () => void
  onStopSelect: (stop: BusStop) => void
}

function MobileHomeContent({
  arrivals,
  nearbyStops,
  isLoading,
  isRefreshing,
  lastRefresh,
  onRefresh,
  onStopSelect,
}: MobileHomeContentProps) {
  if (isLoading) {
    return <LoadingState message="Finding nearby buses..." />
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
          <RefreshCw className={cn('h-5 w-5 text-foreground', isRefreshing && 'animate-spin')} />
        </motion.button>
      </div>

      {/* Arrivals */}
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
                <ETACard arrival={arrival} onPress={() => onStopSelect(arrival.stop)} />
              </motion.div>
            ))}
          </div>
        ) : (
          <EmptyState title="No buses nearby" message="Checking for nearby arrivals..." />
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
              <NearbyStopRow stop={stop} onPress={() => onStopSelect(stop)} />
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
              <RouteCard routeName={route.name} color={route.color} destinations={route.destinations} />
            </motion.div>
          ))}
        </div>
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

export default ResponsiveApp
