'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { RefreshCw, MapPin, Clock, ChevronLeft, HelpCircle, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Arrival, BusStop, Bus, Route } from '@/lib/types'
import { 
  kigaliStops,
  kigaliRoutes,
  kigaliRouteGeometries,
  getNearbyStopsFromLocation,
  generateBusesForRoutes,
  simulateBusMovementOnRoute,
  getRoutesForStop,
  KIGALI_CENTER,
} from '@/lib/kigali-gtfs'
import { BottomSheet } from './bottom-sheet'
import { ETACard, NearbyStopRow, RouteCard } from './cards'
import { WalkingDistance } from './transit-ui'
import { MapboxTransitMap } from './mapbox-transit-map'
import { EmptyState, LoadingState, RefreshingIndicator, SplashScreen } from './states'
import { Onboarding, useOnboarding } from './onboarding'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

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

// Custom hook for haptic feedback
function useHapticFeedback() {
  const triggerHaptic = useCallback((type: 'light' | 'medium' | 'heavy' = 'light') => {
    if ('vibrate' in navigator) {
      const patterns = {
        light: [10],
        medium: [20],
        heavy: [30],
      }
      navigator.vibrate(patterns[type])
    }
  }, [])

  return triggerHaptic
}

// Accessibility announcer
function useAnnouncer() {
  const announce = useCallback((message: string, priority: 'polite' | 'assertive' = 'polite') => {
    const announcer = document.getElementById('screen-reader-announcer')
    if (announcer) {
      announcer.setAttribute('aria-live', priority)
      announcer.textContent = message
      // Clear after announcement
      setTimeout(() => {
        announcer.textContent = ''
      }, 1000)
    }
  }, [])

  return announce
}

export function ResponsiveApp() {
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const isTablet = useMediaQuery('(min-width: 768px)')
  const prefersReducedMotion = useReducedMotion()
  const { showOnboarding, isChecked, completeOnboarding } = useOnboarding()
  const [showSplash, setShowSplash] = useState(true)
  const haptic = useHapticFeedback()
  const announce = useAnnouncer()
  
  // State
  const [selectedStop, setSelectedStop] = useState<BusStop | null>(null)
  const [nearbyStops, setNearbyStops] = useState<BusStop[]>([])
  const [buses, setBuses] = useState<Bus[]>([])
  const [arrivals, setArrivals] = useState<Arrival[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [showTooltip, setShowTooltip] = useState<string | null>(null)

  // Initialize data
  useEffect(() => {
    const loadInitialData = async () => {
      // Get user location
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const loc = {
              lat: position.coords.latitude,
              lng: position.coords.longitude,
            }
            setUserLocation(loc)
            
            // Get nearby stops based on user location
            const nearby = getNearbyStopsFromLocation(loc.lat, loc.lng, 2000, 10)
            setNearbyStops(nearby)
          },
          () => {
            // Default to Kigali center if location denied
            setUserLocation(KIGALI_CENTER)
            const nearby = getNearbyStopsFromLocation(KIGALI_CENTER.lat, KIGALI_CENTER.lng, 2000, 10)
            setNearbyStops(nearby)
          }
        )
      } else {
        setUserLocation(KIGALI_CENTER)
        const nearby = getNearbyStopsFromLocation(KIGALI_CENTER.lat, KIGALI_CENTER.lng, 2000, 10)
        setNearbyStops(nearby)
      }

      // Generate initial buses
      const initialBuses = generateBusesForRoutes()
      setBuses(initialBuses)

      // Generate arrivals
      const initialArrivals = initialBuses.map((bus) => {
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
      
      setArrivals(initialArrivals)
      setLastRefresh(new Date())
      setIsLoading(false)
      
      // Hide splash
      setTimeout(() => setShowSplash(false), 500)
    }

    loadInitialData()
  }, [])

  // Auto-refresh every 15 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setBuses((prev) => prev.map((bus) => simulateBusMovementOnRoute(bus)))
      
      // Update arrivals
      setBuses((currentBuses) => {
        const updatedArrivals = currentBuses.map((bus) => {
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
        
        setArrivals(updatedArrivals)
        return currentBuses
      })
      
      setLastRefresh(new Date())
    }, 15000)

    return () => clearInterval(interval)
  }, [])

  // Manual refresh handler
  const handleRefresh = useCallback(async () => {
    haptic('medium')
    setIsRefreshing(true)
    announce('Refreshing bus data')
    
    await new Promise((resolve) => setTimeout(resolve, 1000))
    
    // Regenerate buses
    const newBuses = generateBusesForRoutes()
    setBuses(newBuses)
    
    // Update arrivals
    const newArrivals = newBuses.map((bus) => {
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
    
    setArrivals(newArrivals)
    
    // Update nearby stops if we have location
    if (userLocation) {
      const nearby = getNearbyStopsFromLocation(userLocation.lat, userLocation.lng, 2000, 10)
      setNearbyStops(nearby)
    }
    
    setLastRefresh(new Date())
    setIsRefreshing(false)
    announce('Bus data updated')
  }, [haptic, announce, userLocation])

  // Stop selection handler with haptic
  const handleStopSelect = useCallback((stop: BusStop) => {
    haptic('light')
    setSelectedStop(stop)
    announce(`Selected stop: ${stop.name}`)
  }, [haptic, announce])

  // Back to home
  const handleBack = useCallback(() => {
    haptic('light')
    setSelectedStop(null)
    announce('Returned to nearby buses')
  }, [haptic, announce])

  // Get arrivals for selected stop
  const stopArrivals = selectedStop
    ? arrivals.filter((a) => {
        const routes = getRoutesForStop(selectedStop.id)
        return routes.some((r) => r.id === a.route.id)
      })
    : []

  // Don't render anything until we check onboarding status
  if (!isChecked) {
    return null
  }

  // Show onboarding if needed
  if (showOnboarding) {
    return <Onboarding onComplete={completeOnboarding} />
  }

  // Render desktop layout
  if (isDesktop) {
    return (
      <TooltipProvider>
        <AnimatePresence>
          {showSplash && <SplashScreen />}
        </AnimatePresence>
        
        {/* Screen reader announcer */}
        <div id="screen-reader-announcer" className="sr-only" aria-live="polite" aria-atomic="true" />
        
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
          prefersReducedMotion={prefersReducedMotion || false}
        />
      </TooltipProvider>
    )
  }

  // Render tablet layout
  if (isTablet) {
    return (
      <TooltipProvider>
        <AnimatePresence>
          {showSplash && <SplashScreen />}
        </AnimatePresence>
        
        <div id="screen-reader-announcer" className="sr-only" aria-live="polite" aria-atomic="true" />
        
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
          prefersReducedMotion={prefersReducedMotion || false}
        />
      </TooltipProvider>
    )
  }

  // Render mobile layout (default)
  return (
    <TooltipProvider>
      <AnimatePresence>
        {showSplash && <SplashScreen />}
      </AnimatePresence>
      
      <div id="screen-reader-announcer" className="sr-only" aria-live="polite" aria-atomic="true" />
      
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
        prefersReducedMotion={prefersReducedMotion || false}
      />
    </TooltipProvider>
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
  prefersReducedMotion: boolean
}

// Desktop layout
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
  prefersReducedMotion,
}: LayoutProps) {
  return (
    <div className="h-screen w-full flex">
      {/* Side panel */}
      <motion.aside
        initial={prefersReducedMotion ? {} : { x: -400 }}
        animate={{ x: 0 }}
        className="w-[420px] h-full bg-background border-r border-border flex flex-col shrink-0"
        role="complementary"
        aria-label="Bus information panel"
      >
        {/* Header */}
        <header className="p-6 border-b border-border">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Tega</h1>
              <p className="text-sm text-muted-foreground">Bus tracking for Kigali</p>
            </div>
            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center hover:bg-accent transition-colors"
                    aria-label="Help and information"
                  >
                    <HelpCircle className="h-5 w-5 text-muted-foreground" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Need help? Tap stops on the map or cards below.</p>
                </TooltipContent>
              </Tooltip>
              <motion.button
                whileHover={prefersReducedMotion ? {} : { scale: 1.05 }}
                whileTap={prefersReducedMotion ? {} : { scale: 0.95 }}
                onClick={onRefresh}
                disabled={isRefreshing}
                className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center hover:bg-accent transition-colors disabled:opacity-50"
                aria-label={isRefreshing ? 'Refreshing...' : 'Refresh bus data'}
              >
                <RefreshCw className={cn('h-5 w-5 text-foreground', isRefreshing && 'animate-spin')} />
              </motion.button>
            </div>
          </div>
          {lastRefresh && (
            <p className="text-xs text-muted-foreground mt-2">
              Updated {formatTimeAgo(lastRefresh)}
            </p>
          )}
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto custom-scrollbar" role="main">
          <AnimatePresence mode="wait">
            {selectedStop ? (
              <StopDetailPanel
                key="stop-detail"
                stop={selectedStop}
                arrivals={stopArrivals}
                onBack={onBack}
                prefersReducedMotion={prefersReducedMotion}
              />
            ) : (
              <HomePanel
                key="home"
                arrivals={arrivals}
                nearbyStops={nearbyStops}
                isLoading={isLoading}
                onStopSelect={onStopSelect}
                prefersReducedMotion={prefersReducedMotion}
              />
            )}
          </AnimatePresence>
        </main>
      </motion.aside>

      {/* Map */}
      <div className="flex-1 relative" role="application" aria-label="Transit map">
        <MapboxTransitMap
          buses={buses}
          stops={kigaliStops}
          routeGeometries={kigaliRouteGeometries}
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

// Tablet layout
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
  prefersReducedMotion,
}: LayoutProps) {
  return (
    <div className="h-screen w-full flex">
      <motion.aside
        initial={prefersReducedMotion ? {} : { x: -360 }}
        animate={{ x: 0 }}
        className="w-[360px] h-full bg-background border-r border-border flex flex-col shrink-0"
        role="complementary"
        aria-label="Bus information panel"
      >
        <header className="p-4 border-b border-border">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-foreground">Tega</h1>
              <p className="text-xs text-muted-foreground">Bus tracking for Kigali</p>
            </div>
            <motion.button
              whileHover={prefersReducedMotion ? {} : { scale: 1.05 }}
              whileTap={prefersReducedMotion ? {} : { scale: 0.95 }}
              onClick={onRefresh}
              disabled={isRefreshing}
              className="h-9 w-9 rounded-full bg-secondary flex items-center justify-center hover:bg-accent transition-colors disabled:opacity-50"
              aria-label={isRefreshing ? 'Refreshing...' : 'Refresh bus data'}
            >
              <RefreshCw className={cn('h-4 w-4 text-foreground', isRefreshing && 'animate-spin')} />
            </motion.button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto custom-scrollbar" role="main">
          <AnimatePresence mode="wait">
            {selectedStop ? (
              <StopDetailPanel
                key="stop-detail"
                stop={selectedStop}
                arrivals={stopArrivals}
                onBack={onBack}
                compact
                prefersReducedMotion={prefersReducedMotion}
              />
            ) : (
              <HomePanel
                key="home"
                arrivals={arrivals}
                nearbyStops={nearbyStops}
                isLoading={isLoading}
                onStopSelect={onStopSelect}
                compact
                prefersReducedMotion={prefersReducedMotion}
              />
            )}
          </AnimatePresence>
        </main>
      </motion.aside>

      <div className="flex-1 relative" role="application" aria-label="Transit map">
        <MapboxTransitMap
          buses={buses}
          stops={kigaliStops}
          routeGeometries={kigaliRouteGeometries}
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

// Mobile layout
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
  prefersReducedMotion,
}: LayoutProps) {
  return (
    <div className="relative h-screen w-full overflow-hidden">
      <div role="application" aria-label="Transit map" className="absolute inset-0">
        <MapboxTransitMap
          buses={buses}
          stops={kigaliStops}
          routeGeometries={kigaliRouteGeometries}
          userLocation={userLocation || undefined}
          selectedStopId={selectedStop?.id}
          onStopClick={onStopSelect}
          className="absolute inset-0"
        />
      </div>

      <BottomSheet defaultHeight={45} minHeight={30} maxHeight={85}>
        <AnimatePresence mode="wait">
          {selectedStop ? (
            <StopDetailPanel
              key="stop-detail"
              stop={selectedStop}
              arrivals={stopArrivals}
              onBack={onBack}
              prefersReducedMotion={prefersReducedMotion}
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
              prefersReducedMotion={prefersReducedMotion}
            />
          )}
        </AnimatePresence>
      </BottomSheet>

      <RefreshingIndicator isRefreshing={isRefreshing} />
    </div>
  )
}

// Home panel
interface HomePanelProps {
  arrivals: Arrival[]
  nearbyStops: BusStop[]
  isLoading: boolean
  onStopSelect: (stop: BusStop) => void
  compact?: boolean
  prefersReducedMotion: boolean
}

function HomePanel({ arrivals, nearbyStops, isLoading, onStopSelect, compact, prefersReducedMotion }: HomePanelProps) {
  if (isLoading) {
    return <LoadingState />
  }

  return (
    <motion.div
      initial={prefersReducedMotion ? {} : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={prefersReducedMotion ? {} : { opacity: 0 }}
      className={cn('space-y-6', compact ? 'p-4' : 'p-6')}
    >
      {/* ETA explanation tooltip */}
      <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-xl">
        <Info className="h-4 w-4 text-muted-foreground shrink-0" />
        <p className="text-xs text-muted-foreground">
          ETAs show ranges, not exact times. Higher confidence means more reliable data.
        </p>
      </div>

      {/* Arrivals */}
      <section className="space-y-3" aria-labelledby="arrivals-heading">
        <h2 id="arrivals-heading" className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Arriving Soon
        </h2>
        {arrivals.length > 0 ? (
          <ul className="space-y-2" role="list">
            {arrivals.slice(0, 5).map((arrival, index) => (
              <motion.li
                key={arrival.id}
                initial={prefersReducedMotion ? {} : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                <ETACard
                  arrival={arrival}
                  onPress={() => onStopSelect(arrival.stop)}
                  compact={compact}
                />
              </motion.li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No buses nearby" message="Checking for nearby arrivals..." />
        )}
      </section>

      {/* Nearby stops */}
      <section className="space-y-3" aria-labelledby="stops-heading">
        <h2 id="stops-heading" className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Nearby Stops
        </h2>
        <ul className="space-y-1" role="list">
          {nearbyStops.slice(0, 4).map((stop, index) => (
            <motion.li
              key={stop.id}
              initial={prefersReducedMotion ? {} : { opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 + index * 0.05 }}
            >
              <NearbyStopRow stop={stop} onPress={() => onStopSelect(stop)} />
            </motion.li>
          ))}
        </ul>
      </section>

      {/* Routes */}
      <section className="space-y-3" aria-labelledby="routes-heading">
        <h2 id="routes-heading" className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Routes
        </h2>
        <ul className="space-y-2" role="list">
          {kigaliRoutes.slice(0, 4).map((route, index) => (
            <motion.li
              key={route.id}
              initial={prefersReducedMotion ? {} : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + index * 0.05 }}
            >
              <RouteCard
                routeName={route.name}
                color={route.color}
                destinations={route.destinations}
              />
            </motion.li>
          ))}
        </ul>
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
  prefersReducedMotion: boolean
}

function StopDetailPanel({ stop, arrivals, onBack, compact, prefersReducedMotion }: StopDetailPanelProps) {
  return (
    <motion.div
      initial={prefersReducedMotion ? {} : { opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={prefersReducedMotion ? {} : { opacity: 0, x: -20 }}
      className={cn(compact ? 'p-4' : 'p-6')}
      role="region"
      aria-label={`Details for ${stop.name}`}
    >
      <header className="flex items-center gap-3 mb-6">
        <motion.button
          whileHover={prefersReducedMotion ? {} : { scale: 1.05 }}
          whileTap={prefersReducedMotion ? {} : { scale: 0.95 }}
          onClick={onBack}
          className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center hover:bg-accent transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background"
          aria-label="Go back to all stops"
        >
          <ChevronLeft className="h-5 w-5 text-foreground" />
        </motion.button>
        <div className="flex-1">
          <h2 className={cn('font-bold text-foreground text-balance', compact ? 'text-lg' : 'text-xl')}>
            {stop.name}
          </h2>
          <WalkingDistance minutes={stop.walkingDistance} meters={stop.walkingMeters} />
        </div>
      </header>

      <section className="space-y-3" aria-labelledby="stop-arrivals-heading">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h3 id="stop-arrivals-heading" className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Upcoming Arrivals
          </h3>
        </div>
        {arrivals.length > 0 ? (
          <ul className="space-y-2" role="list">
            {arrivals.map((arrival, index) => (
              <motion.li
                key={arrival.id}
                initial={prefersReducedMotion ? {} : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                <ETACard arrival={arrival} compact />
              </motion.li>
            ))}
          </ul>
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
  prefersReducedMotion: boolean
}

function MobileHomeContent({
  arrivals,
  nearbyStops,
  isLoading,
  isRefreshing,
  lastRefresh,
  onRefresh,
  onStopSelect,
  prefersReducedMotion,
}: MobileHomeContentProps) {
  if (isLoading) {
    return <LoadingState message="Finding nearby buses..." />
  }

  return (
    <motion.div
      initial={prefersReducedMotion ? {} : { opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={prefersReducedMotion ? {} : { opacity: 0, y: -20 }}
      className="px-4 pb-8 space-y-6"
      role="main"
    >
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Nearby Buses</h1>
          {lastRefresh && (
            <p className="text-sm text-muted-foreground mt-0.5">
              Updated {formatTimeAgo(lastRefresh)}
            </p>
          )}
        </div>
        <motion.button
          whileHover={prefersReducedMotion ? {} : { scale: 1.05 }}
          whileTap={prefersReducedMotion ? {} : { scale: 0.95 }}
          onClick={onRefresh}
          disabled={isRefreshing}
          className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center hover:bg-accent transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary"
          aria-label={isRefreshing ? 'Refreshing...' : 'Refresh bus data'}
        >
          <RefreshCw className={cn('h-5 w-5 text-foreground', isRefreshing && 'animate-spin')} aria-hidden="true" />
        </motion.button>
      </header>

      {/* Quick tip */}
      <div className="flex items-start gap-2 p-3 bg-primary/10 rounded-xl border border-primary/20">
        <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" aria-hidden="true" />
        <p className="text-xs text-foreground">
          <strong>Tip:</strong> Tap any stop on the map or below to see all buses arriving there.
        </p>
      </div>

      <section className="space-y-3" aria-labelledby="mobile-arrivals-heading">
        <h2 id="mobile-arrivals-heading" className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Arriving Soon
        </h2>
        {arrivals.length > 0 ? (
          <ul className="space-y-2" role="list">
            {arrivals.slice(0, 5).map((arrival, index) => (
              <motion.li
                key={arrival.id}
                initial={prefersReducedMotion ? {} : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                <ETACard
                  arrival={arrival}
                  onPress={() => onStopSelect(arrival.stop)}
                />
              </motion.li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No buses nearby" message="Pull down to refresh or move closer to a stop." />
        )}
      </section>

      <section className="space-y-3" aria-labelledby="mobile-stops-heading">
        <h2 id="mobile-stops-heading" className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Nearby Stops
        </h2>
        <ul className="space-y-1" role="list">
          {nearbyStops.slice(0, 4).map((stop, index) => (
            <motion.li
              key={stop.id}
              initial={prefersReducedMotion ? {} : { opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 + index * 0.05 }}
            >
              <NearbyStopRow stop={stop} onPress={() => onStopSelect(stop)} />
            </motion.li>
          ))}
        </ul>
      </section>

      <section className="space-y-3" aria-labelledby="mobile-routes-heading">
        <h2 id="mobile-routes-heading" className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Routes
        </h2>
        <ul className="space-y-2" role="list">
          {kigaliRoutes.slice(0, 4).map((route, index) => (
            <motion.li
              key={route.id}
              initial={prefersReducedMotion ? {} : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + index * 0.05 }}
            >
              <RouteCard
                routeName={route.name}
                color={route.color}
                destinations={route.destinations}
              />
            </motion.li>
          ))}
        </ul>
      </section>
    </motion.div>
  )
}

// Time formatting helper
function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}

export default ResponsiveApp
