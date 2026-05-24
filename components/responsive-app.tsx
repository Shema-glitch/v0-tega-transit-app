'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import Link from 'next/link'
import {
  ArrowClockwise,
  MapPin,
  Clock,
  CaretLeft,
  Question,
  Info,
  Bus,
  CaretRight,
  Stack,
  Gear,
} from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { Arrival, BusStop, Bus as BusType, Route } from '@/lib/types'
import {
  kigaliStops,
  kigaliRoutes,
  kigaliRouteGeometries,
  getNearbyStopsFromLocation,
  generateBusesForRoutes,
  simulateBusMovementOnRoute,
  getRoutesForStop,
  KIGALI_CENTER,
  spawnDynamicBusesForStop,
} from '@/lib/kigali-gtfs'
import { fetchStops } from '@/lib/api'
import { BottomSheet } from './bottom-sheet'
import { ETACard, NearbyStopRow, RouteCard } from './cards'
import { WalkingDistance } from './transit-ui'
import { MapboxTransitMap } from './mapbox-transit-map'
import { EmptyState, LoadingState, RefreshingIndicator, SplashScreen } from './states'
import { SearchBar } from './search-bar'
import { Onboarding, useOnboarding } from './onboarding'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

// ─── Screen size hook ──────────────────────────────────────────────────────
function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false)
  useEffect(() => {
    const media = window.matchMedia(query)
    setMatches(media.matches)
    const listener = () => setMatches(media.matches)
    media.addEventListener('change', listener)
    return () => media.removeEventListener('change', listener)
  }, [query])
  return matches
}

// ─── Haptic feedback ───────────────────────────────────────────────────────
function useHapticFeedback() {
  return useCallback((type: 'light' | 'medium' | 'heavy' = 'light') => {
    if ('vibrate' in navigator) {
      navigator.vibrate({ light: [10], medium: [20], heavy: [30] }[type])
    }
  }, [])
}

// ─── Screen reader announcer ───────────────────────────────────────────────
function useAnnouncer() {
  return useCallback((message: string, priority: 'polite' | 'assertive' = 'polite') => {
    const el = document.getElementById('screen-reader-announcer')
    if (el) {
      el.setAttribute('aria-live', priority)
      el.textContent = message
      setTimeout(() => { el.textContent = '' }, 1000)
    }
  }, [])
}

// ─── Time formatting ───────────────────────────────────────────────────────
function formatTimeAgo(date: Date): string {
  const s = Math.floor((Date.now() - date.getTime()) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  return `${Math.floor(m / 60)}h ago`
}

// ─── Shared props ──────────────────────────────────────────────────────────
interface LayoutProps {
  arrivals: Arrival[]
  nearbyStops: BusStop[]
  buses: BusType[]
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
  dynamicStops?: BusStop[]
}

// ═══════════════════════════════════════════════════════════════════════════
// ROOT COMPONENT
// ═══════════════════════════════════════════════════════════════════════════
export function ResponsiveApp() {
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const isTablet  = useMediaQuery('(min-width: 768px)')
  const prefersReducedMotion = useReducedMotion()
  const { showOnboarding, isChecked, completeOnboarding } = useOnboarding()
  const [showSplash, setShowSplash] = useState(true)
  const haptic   = useHapticFeedback()
  const announce = useAnnouncer()

  const [selectedStop, setSelectedStop] = useState<BusStop | null>(null)
  const [dynamicStops, setDynamicStops] = useState<BusStop[]>([])
  const [nearbyStops,  setNearbyStops]  = useState<BusStop[]>([])
  const [buses,        setBuses]        = useState<BusType[]>([])
  const [arrivals,     setArrivals]     = useState<Arrival[]>([])
  const [isLoading,    setIsLoading]    = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastRefresh,  setLastRefresh]  = useState<Date | null>(null)
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null)

  // Build arrivals from buses
  const buildArrivals = useCallback((busList: BusType[], currentStops: BusStop[]) =>
    busList.map(bus => {
      const activeStops = currentStops.length > 0 ? currentStops : kigaliStops
      const stop  = activeStops.find(s => s.id === bus.stopId) || activeStops[0] || kigaliStops[0]
      const route = kigaliRoutes.find(r => r.id === bus.routeId)!
      return { id: `arrival-${bus.id}`, bus, stop, route, eta: bus.eta }
    }).sort((a, b) => a.eta.min - b.eta.min)
  , [])

  // Consolidated Data Initialization (API + Geolocation)
  useEffect(() => {
    const initializeApp = async () => {
      setIsLoading(true)

      try {
        // 1. Fetch real GTFS data (or fallback)
        const stops = await fetchStops()
        setDynamicStops(stops)

        // 2. Setup Geolocation
        const setLocation = (lat: number, lng: number) => {
          setUserLocation({ lat, lng })
          if (stops && stops.length > 0) {
            setNearbyStops(getNearbyStopsFromLocation(stops, lat, lng, 2000, 10))
          } else {
            setNearbyStops(getNearbyStopsFromLocation(kigaliStops, lat, lng, 2000, 10))
          }
        }

        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            p => setLocation(p.coords.latitude, p.coords.longitude),
            () => setLocation(KIGALI_CENTER.lat, KIGALI_CENTER.lng)
          )
        } else {
          setLocation(KIGALI_CENTER.lat, KIGALI_CENTER.lng)
        }

        // 3. Initialize simulated buses for MVP
        const initial = generateBusesForRoutes()
        setBuses(initial)
        setArrivals(buildArrivals(initial, stops || []))
        setLastRefresh(new Date())

      } catch (err) {
        console.error("Initialization error:", err)
      } finally {
        setIsLoading(false)
        setTimeout(() => setShowSplash(false), 500)
      }
    }

    initializeApp()
  }, [buildArrivals])

  // Realtime SSE & Dead Reckoning
  useEffect(() => {
    if (!userLocation) return

    let eventSource: EventSource | null = null
    let animationFrameId: number
    
    // Track velocity for dead reckoning
    const vehicleVelocities = new Map<string, { speedMetersPerSec: number, headingRad: number }>()

    const connectSSE = () => {
      // 1. Establish Region Subscription
      const url = `/api/realtime/sse?lat=${userLocation.lat}&lng=${userLocation.lng}&radius=4000`
      eventSource = new EventSource(url)

      eventSource.addEventListener('message', (e) => {
        try {
          const payload = JSON.parse(e.data)
          // 2. Consume Delta Payload
          if (payload.type === 'vehicle:update' && payload.vehicles) {
            setBuses(prev => {
              const updatedBuses = [...prev]
              payload.vehicles.forEach((incoming: any) => {
                const idx = updatedBuses.findIndex(b => b.id === incoming.id)
                
                // Track for dead reckoning
                if (incoming.spd !== undefined && incoming.brg !== undefined) {
                  vehicleVelocities.set(incoming.id, {
                    speedMetersPerSec: incoming.spd / 3.6,
                    headingRad: (incoming.brg * Math.PI) / 180
                  })
                }

                if (idx !== -1) {
                  // Merge delta into existing bus
                  updatedBuses[idx] = {
                    ...updatedBuses[idx],
                    currentPosition: { 
                      latitude: incoming.lat ?? updatedBuses[idx].currentPosition.latitude, 
                      longitude: incoming.lng ?? updatedBuses[idx].currentPosition.longitude 
                    },
                    heading: incoming.brg ?? updatedBuses[idx].heading,
                    lastUpdated: new Date()
                  }
                } else {
                  // Spawn new bus from SSE
                  const route = kigaliRoutes.find(r => r.id === incoming.routeId)
                  if (route) {
                    updatedBuses.push({
                      id: incoming.id,
                      routeId: route.id,
                      routeName: route.name,
                      destination: route.destinations[0],
                      currentPosition: { latitude: incoming.lat, longitude: incoming.lng },
                      heading: incoming.brg || 0,
                      eta: { min: 2, max: 4, label: '2 - 4 min', confidence: 'medium' },
                      stopId: 'unknown',
                      lastUpdated: new Date()
                    })
                  }
                }
              })
              
              // Rebuild ETAs based on new real positions
              setArrivals(buildArrivals(updatedBuses, dynamicStops))
              setLastRefresh(new Date())
              return updatedBuses
            })
          }
        } catch (error) {
          console.error("SSE parse error", error)
        }
      })
    }

    connectSSE()

    // 3. Dead Reckoning Engine
    let lastTime = performance.now()
    const tick = (time: number) => {
      const deltaMs = time - lastTime
      lastTime = time

      setBuses(prev => prev.map(bus => {
        const vel = vehicleVelocities.get(bus.id)
        if (!vel) return bus
        
        // Advance position based on velocity
        // 1 degree of latitude is roughly 111,320 meters
        const speedDegreesPerSec = vel.speedMetersPerSec / 111320
        const deltaDegrees = speedDegreesPerSec * (deltaMs / 1000)
        
        const dLat = Math.cos(vel.headingRad) * deltaDegrees
        const dLng = Math.sin(vel.headingRad) * deltaDegrees

        return {
          ...bus,
          currentPosition: {
            latitude: bus.currentPosition.latitude + dLat,
            longitude: bus.currentPosition.longitude + dLng
          }
        }
      }))

      animationFrameId = requestAnimationFrame(tick)
    }

    animationFrameId = requestAnimationFrame(tick)

    return () => {
      if (eventSource) eventSource.close()
      cancelAnimationFrame(animationFrameId)
    }
  }, [userLocation, buildArrivals, dynamicStops])

  const handleRefresh = useCallback(async () => {
    haptic('medium')
    setIsRefreshing(true)
    announce('Refreshing bus data')
    await new Promise(r => setTimeout(r, 1000))
    const next = generateBusesForRoutes()
    setBuses(next)
    setArrivals(buildArrivals(next, dynamicStops))
    if (userLocation) {
      setNearbyStops(getNearbyStopsFromLocation(dynamicStops.length > 0 ? dynamicStops : kigaliStops, userLocation.lat, userLocation.lng, 2000, 10))
    }
    setLastRefresh(new Date())
    setIsRefreshing(false)
    announce('Bus data updated')
  }, [haptic, announce, userLocation, buildArrivals])

  const handleStopSelect = useCallback((stop: BusStop) => {
    haptic('light')
    setSelectedStop(stop)
    
    // Dynamically spawn buses if this stop has no arrivals
    setArrivals(prevArrivals => {
      const existingArrivals = prevArrivals.filter(a => a.stop.id === stop.id)
      if (existingArrivals.length === 0) {
        const newBuses = spawnDynamicBusesForStop(stop)
        setBuses(prev => [...prev, ...newBuses])
        
        // Build arrivals for just the new buses and append them
        const newArrivals = newBuses.map(bus => {
          const route = kigaliRoutes.find(r => r.id === bus.routeId)!
          return { id: `arrival-${bus.id}`, bus, stop, route, eta: bus.eta }
        })
        return [...prevArrivals, ...newArrivals].sort((a, b) => a.eta.min - b.eta.min)
      }
      return prevArrivals
    })

    announce(`Selected stop: ${stop.name}`)
  }, [haptic, announce])

  const handleBack = useCallback(() => {
    haptic('light')
    setSelectedStop(null)
    announce('Returned to nearby buses')
  }, [haptic, announce])

  const stopArrivals = selectedStop
    ? arrivals.filter(a => a.stop.id === selectedStop.id || getRoutesForStop(selectedStop.id).some(r => r.id === a.route.id))
    : []

  if (!isChecked) return null
  if (showOnboarding) return <Onboarding onComplete={completeOnboarding} />

  const layoutProps: LayoutProps = {
    arrivals, nearbyStops, buses, isLoading, isRefreshing, lastRefresh,
    userLocation, selectedStop, stopArrivals,
    onRefresh: handleRefresh, onStopSelect: handleStopSelect, onBack: handleBack,
    prefersReducedMotion: prefersReducedMotion ?? false,
    dynamicStops
  }

  return (
    <TooltipProvider>
      <AnimatePresence>{showSplash && <SplashScreen />}</AnimatePresence>
      <div id="screen-reader-announcer" className="sr-only" aria-live="polite" aria-atomic="true" />

      {isDesktop ? (
        <DesktopLayout {...layoutProps} />
      ) : isTablet ? (
        <TabletLayout {...layoutProps} />
      ) : (
        <MobileLayout {...layoutProps} />
      )}
    </TooltipProvider>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// DESKTOP LAYOUT — Cinematic, map-native, premium
// ═══════════════════════════════════════════════════════════════════════════
function DesktopLayout({
  arrivals, nearbyStops, buses, isLoading, isRefreshing, lastRefresh,
  userLocation, selectedStop, stopArrivals, onRefresh, onStopSelect, onBack,
  prefersReducedMotion,
}: LayoutProps) {
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const activeCount = buses.filter(b => b.eta.min <= 15).length

  return (
    <div className="h-screen w-full flex overflow-hidden">

      {/* ── Side Panel ── */}
      <motion.aside
        initial={prefersReducedMotion ? {} : { x: -460 }}
        animate={{ x: 0, width: panelCollapsed ? 0 : 440 }}
        transition={{ type: 'spring', stiffness: 300, damping: 35 }}
        className="h-full flex flex-col shrink-0 overflow-hidden bg-background shadow-panel border-r border-border"
        role="complementary"
        aria-label="Bus information panel"
      >
        {/* ── Panel Header — Uber-inspired brand strip ── */}
        <div className="panel-header shrink-0 bg-background">
          <div className="px-6 pt-5 pb-4">
            {/* Top row: branding + actions */}
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                {/* Large teal bus icon — recognizable brand mark */}
                <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center shrink-0 shadow-sm">
                  <Bus size={22} weight="fill" className="text-white" />
                </div>
                <div>
                  <h1
                    className="text-foreground leading-none"
                    style={{ fontSize: '1.625rem', fontWeight: 900, letterSpacing: '-0.03em' }}
                  >
                    Tega
                  </h1>
                  <p className="text-xs text-muted-foreground font-semibold mt-0.5">Kigali bus tracker</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Link href="/settings" aria-label="Settings">
                  <motion.div
                    whileHover={prefersReducedMotion ? {} : { scale: 1.06 }}
                    whileTap={prefersReducedMotion ? {} : { scale: 0.94 }}
                    className="h-9 w-9 rounded-full bg-secondary flex items-center justify-center hover:bg-accent transition-colors disabled:opacity-50"
                  >
                    <Gear size={18} weight="fill" className="text-foreground" />
                  </motion.div>
                </Link>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <motion.button
                      whileHover={prefersReducedMotion ? {} : { scale: 1.06 }}
                      whileTap={prefersReducedMotion ? {} : { scale: 0.94 }}
                      onClick={onRefresh}
                      disabled={isRefreshing}
                      className="touch-target-lg h-9 w-9 rounded-full bg-secondary border border-border/40 flex items-center justify-center hover:bg-accent transition-colors disabled:opacity-40"
                      aria-label={isRefreshing ? 'Refreshing…' : 'Refresh bus data'}
                    >
                      <ArrowClockwise size={16} weight="bold" className={cn('text-foreground', isRefreshing && 'animate-spin')} />
                    </motion.button>
                  </TooltipTrigger>
                  <TooltipContent><p>Refresh live data</p></TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <motion.button
                      whileHover={prefersReducedMotion ? {} : { scale: 1.06 }}
                      whileTap={prefersReducedMotion ? {} : { scale: 0.94 }}
                      className="touch-target-lg h-9 w-9 rounded-full bg-secondary border border-border/40 flex items-center justify-center hover:bg-accent transition-colors"
                      aria-label="Help"
                    >
                      <Question size={16} weight="bold" className="text-foreground" />
                    </motion.button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Click stops on the map or cards below to view arrivals</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>

            {/* Search Bar - Below Header Elements */}
            <div className="mb-3">
              <SearchBar onStopSelect={onStopSelect} className="max-w-full" />
            </div>

            {/* Live status + last refresh */}
            <div className="flex items-center justify-between mt-3">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary border border-border/40">
                <span className="live-dot" />
                <span className="text-xs font-bold text-foreground">Live</span>
                <span className="text-xs text-muted-foreground">·</span>
                <span className="text-xs font-medium text-muted-foreground">{activeCount} buses active</span>
              </div>
              {lastRefresh && (
                <p className="text-xs font-medium text-muted-foreground">{formatTimeAgo(lastRefresh)}</p>
              )}
            </div>
          </div>
        </div>

        {/* ── Panel Content ── */}
        <main className="flex-1 overflow-y-auto custom-scrollbar" role="main">
          <AnimatePresence mode="wait">
            {selectedStop ? (
              <DesktopStopDetailPanel
                key="stop-detail"
                stop={selectedStop}
                arrivals={stopArrivals}
                onBack={onBack}
                prefersReducedMotion={prefersReducedMotion}
              />
            ) : (
              <DesktopHomePanel
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

        {/* ── Panel Footer ── */}
        <div className="shrink-0 px-6 py-3 border-t border-border/40 flex items-center justify-between">
          <p className="text-xs text-muted-foreground/60">
            {kigaliRoutes.length} routes · {kigaliStops.length} stops
          </p>
          <p className="text-xs text-muted-foreground/40">Kigali GTFS</p>
        </div>
      </motion.aside>

      {/* ── Map Area ── */}
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

        {/* Collapse/expand panel toggle */}
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          onClick={() => setPanelCollapsed(v => !v)}
          className="absolute top-5 left-4 z-20 h-9 w-9 rounded-full map-control-pill flex items-center justify-center hover:bg-accent/20 transition-colors"
          aria-label={panelCollapsed ? 'Open panel' : 'Collapse panel'}
        >
          <CaretRight size={16} weight="bold" className={`text-foreground transition-transform ${panelCollapsed ? '' : 'rotate-180'}`} />
        </motion.button>

      </div>

      <RefreshingIndicator isRefreshing={isRefreshing} />
    </div>
  )
}

// Desktop: Home Panel content
interface DesktopHomePanelProps {
  arrivals: Arrival[]
  nearbyStops: BusStop[]
  isLoading: boolean
  onStopSelect: (stop: BusStop) => void
  prefersReducedMotion: boolean
}

function DesktopHomePanel({ arrivals, nearbyStops, isLoading, onStopSelect, prefersReducedMotion }: DesktopHomePanelProps) {
  if (isLoading) return <LoadingState />

  return (
    <motion.div
      initial={prefersReducedMotion ? {} : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={prefersReducedMotion ? {} : { opacity: 0 }}
      className="py-2"
    >
      {/* ETA info hint */}
      <div className="mx-5 mt-4 mb-1 flex items-start gap-2 px-3 py-2.5 bg-primary/8 border border-primary/15 rounded-xl">
        <Info className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          ETAs are confidence-based ranges, not exact countdowns.
        </p>
      </div>

      {/* Arrivals section */}
      <Section label="Arriving Soon" className="mt-5">
        {arrivals.length > 0 ? (
          <ul className="space-y-1.5 px-5" role="list">
            {arrivals.slice(0, 8).map((arrival, i) => (
              <motion.li
                key={arrival.id}
                initial={prefersReducedMotion ? {} : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
              >
                <ETACard arrival={arrival} onPress={() => onStopSelect(arrival.stop)} compact desktop />
              </motion.li>
            ))}
          </ul>
        ) : (
          <div className="px-5"><EmptyState title="No buses nearby" message="Checking for nearby arrivals…" /></div>
        )}
      </Section>

      {/* Nearby stops */}
      <Section label="Nearby Stops" className="mt-6">
        <ul className="space-y-0.5 px-5" role="list">
          {nearbyStops.slice(0, 6).map((stop, i) => (
            <motion.li
              key={stop.id}
              initial={prefersReducedMotion ? {} : { opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 + i * 0.04 }}
            >
              <NearbyStopRow stop={stop} onPress={() => onStopSelect(stop)} />
            </motion.li>
          ))}
        </ul>
      </Section>

      {/* Routes */}
      <Section label="Routes" className="mt-6 mb-4">
        <ul className="space-y-1.5 px-5" role="list">
          {kigaliRoutes.map((route, i) => (
            <motion.li
              key={route.id}
              initial={prefersReducedMotion ? {} : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + i * 0.03 }}
            >
              <RouteCard
                routeName={route.name}
                color={route.color}
                destinations={route.destinations}
              />
            </motion.li>
          ))}
        </ul>
      </Section>
    </motion.div>
  )
}

// Desktop: Stop detail
interface DesktopStopDetailPanelProps {
  stop: BusStop
  arrivals: Arrival[]
  onBack: () => void
  prefersReducedMotion: boolean
}

function DesktopStopDetailPanel({ stop, arrivals, onBack, prefersReducedMotion }: DesktopStopDetailPanelProps) {
  return (
    <motion.div
      initial={prefersReducedMotion ? {} : { opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={prefersReducedMotion ? {} : { opacity: 0, x: -24 }}
      role="region"
      aria-label={`Stop: ${stop.name}`}
    >
      {/* Stop header */}
      <div className="px-5 pt-5 pb-4 border-b border-border/40">
        <div className="flex items-center gap-3">
          <motion.button
            whileHover={prefersReducedMotion ? {} : { scale: 1.08 }}
            whileTap={prefersReducedMotion ? {} : { scale: 0.93 }}
            onClick={onBack}
            className="h-9 w-9 rounded-full bg-secondary flex items-center justify-center hover:bg-accent transition-colors focus:outline-none focus:ring-2 focus:ring-primary touch-target"
            aria-label="Back to all buses"
          >
            <CaretLeft size={18} weight="bold" className="text-foreground" />
          </motion.button>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-foreground text-balance leading-tight">{stop.name}</h2>
            <WalkingDistance minutes={stop.walkingDistance} meters={stop.walkingMeters} />
          </div>
        </div>
      </div>

      {/* Arrivals */}
      <Section label="Upcoming Arrivals" className="mt-4">
        {arrivals.length > 0 ? (
          <ul className="space-y-1.5 px-5" role="list">
            {arrivals.map((arrival, i) => (
              <motion.li
                key={arrival.id}
                initial={prefersReducedMotion ? {} : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <ETACard arrival={arrival} compact desktop />
              </motion.li>
            ))}
          </ul>
        ) : (
          <div className="px-5"><EmptyState title="No upcoming buses" message="Checking for arrivals at this stop…" /></div>
        )}
      </Section>
    </motion.div>
  )
}


// ═══════════════════════════════════════════════════════════════════════════
// TABLET LAYOUT — Immersive, spacious, touch-native
// ═══════════════════════════════════════════════════════════════════════════
function TabletLayout({
  arrivals, nearbyStops, buses, isLoading, isRefreshing, lastRefresh,
  userLocation, selectedStop, stopArrivals, onRefresh, onStopSelect, onBack,
  prefersReducedMotion,
}: LayoutProps) {
  const activeCount = buses.filter(b => b.eta.min <= 15).length

  return (
    <div className="h-screen w-full flex overflow-hidden">
      {/* ── Side Panel ── */}
      <motion.aside
        initial={prefersReducedMotion ? {} : { x: -380 }}
        animate={{ x: 0 }}
        transition={{ type: 'spring', stiffness: 280, damping: 32 }}
        className="h-full flex flex-col shrink-0 bg-background shadow-panel border-r border-border"
        style={{
          width: 'var(--sidebar-tablet-width)',
        }}
        role="complementary"
        aria-label="Bus information panel"
      >
        {/* Header */}
        <div className="panel-header shrink-0 bg-background">
          <div className="px-5 pt-5 pb-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-primary flex items-center justify-center shrink-0">
                  <Bus size={20} weight="fill" className="text-white" />
                </div>
                <div>
                  <h1
                    className="text-foreground leading-none"
                    style={{ fontSize: '1.375rem', fontWeight: 900, letterSpacing: '-0.03em' }}
                  >Tega</h1>
                  <p className="text-xs text-muted-foreground font-semibold mt-0.5">Kigali bus tracker</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Link href="/settings" aria-label="Settings">
                  <motion.div
                    whileHover={prefersReducedMotion ? {} : { scale: 1.06 }}
                    whileTap={prefersReducedMotion ? {} : { scale: 0.94 }}
                    className="touch-target-lg h-10 w-10 rounded-full bg-secondary border border-border/40 flex items-center justify-center hover:bg-accent transition-colors disabled:opacity-40"
                  >
                    <Gear size={18} weight="fill" className="text-foreground" />
                  </motion.div>
                </Link>
                <motion.button
                  whileHover={prefersReducedMotion ? {} : { scale: 1.06 }}
                  whileTap={prefersReducedMotion ? {} : { scale: 0.94 }}
                  onClick={onRefresh}
                  disabled={isRefreshing}
                  className="touch-target-lg h-10 w-10 rounded-full bg-secondary border border-border/40 flex items-center justify-center hover:bg-accent transition-colors disabled:opacity-40"
                  aria-label={isRefreshing ? 'Refreshing…' : 'Refresh'}
                >
                  <ArrowClockwise size={18} weight="bold" className={cn('text-foreground', isRefreshing && 'animate-spin')} />
                </motion.button>
              </div>
            </div>

            {/* Search Bar - Tablet Panel */}
            <div className="mb-3">
              <SearchBar onStopSelect={onStopSelect} className="max-w-full" />
            </div>

            {/* Status row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary border border-border/40">
                <span className="live-dot" />
                <span className="text-xs font-bold text-foreground">Live</span>
                <span className="text-xs text-muted-foreground">· {activeCount} buses</span>
              </div>
              {lastRefresh && (
                <p className="text-xs font-medium text-muted-foreground">{formatTimeAgo(lastRefresh)}</p>
              )}
            </div>
          </div>
        </div>

        {/* Content */}
        <main className="flex-1 overflow-y-auto custom-scrollbar" role="main">
          <AnimatePresence mode="wait">
            {selectedStop ? (
              <TabletStopDetailPanel
                key="stop-detail"
                stop={selectedStop}
                arrivals={stopArrivals}
                onBack={onBack}
                prefersReducedMotion={prefersReducedMotion}
              />
            ) : (
              <TabletHomePanel
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

        {/* Footer */}
        <div className="shrink-0 px-5 py-3 border-t border-border/40 flex items-center justify-between">
          <p className="text-xs text-muted-foreground/60">{kigaliRoutes.length} routes · {kigaliStops.length} stops</p>
          <div className="flex items-center gap-1">
            <Stack size={10} weight="duotone" className="text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground/40">GTFS</p>
          </div>
        </div>
      </motion.aside>

      {/* ── Map ── */}
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

// Tablet: Home Panel
interface TabletHomePanelProps {
  arrivals: Arrival[]
  nearbyStops: BusStop[]
  isLoading: boolean
  onStopSelect: (stop: BusStop) => void
  prefersReducedMotion: boolean
}

function TabletHomePanel({ arrivals, nearbyStops, isLoading, onStopSelect, prefersReducedMotion }: TabletHomePanelProps) {
  if (isLoading) return <LoadingState />
  return (
    <motion.div
      initial={prefersReducedMotion ? {} : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={prefersReducedMotion ? {} : { opacity: 0 }}
      className="py-2"
    >
      {/* ETA hint */}
      <div className="mx-5 mt-4 mb-1 flex items-start gap-2 px-3 py-2.5 bg-muted/50 rounded-xl">
        <Info className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
        <p className="text-xs text-muted-foreground">ETAs show ranges — higher confidence means more reliable data.</p>
      </div>

      <Section label="Arriving Soon" className="mt-5">
        {arrivals.length > 0 ? (
          <ul className="space-y-2 px-5" role="list">
            {arrivals.slice(0, 6).map((arrival, i) => (
              <motion.li
                key={arrival.id}
                initial={prefersReducedMotion ? {} : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <ETACard arrival={arrival} onPress={() => onStopSelect(arrival.stop)} />
              </motion.li>
            ))}
          </ul>
        ) : (
          <div className="px-5"><EmptyState title="No buses nearby" message="Checking for nearby arrivals…" /></div>
        )}
      </Section>

      <Section label="Nearby Stops" className="mt-6">
        <ul className="space-y-1 px-5" role="list">
          {nearbyStops.slice(0, 5).map((stop, i) => (
            <motion.li
              key={stop.id}
              initial={prefersReducedMotion ? {} : { opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 + i * 0.04 }}
            >
              <NearbyStopRow stop={stop} onPress={() => onStopSelect(stop)} />
            </motion.li>
          ))}
        </ul>
      </Section>

      <Section label="Routes" className="mt-6 mb-4">
        <ul className="space-y-2 px-5" role="list">
          {kigaliRoutes.slice(0, 5).map((route, i) => (
            <motion.li
              key={route.id}
              initial={prefersReducedMotion ? {} : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + i * 0.04 }}
            >
              <RouteCard routeName={route.name} color={route.color} destinations={route.destinations} />
            </motion.li>
          ))}
        </ul>
      </Section>
    </motion.div>
  )
}

// Tablet: Stop Detail
interface TabletStopDetailPanelProps {
  stop: BusStop
  arrivals: Arrival[]
  onBack: () => void
  prefersReducedMotion: boolean
}

function TabletStopDetailPanel({ stop, arrivals, onBack, prefersReducedMotion }: TabletStopDetailPanelProps) {
  return (
    <motion.div
      initial={prefersReducedMotion ? {} : { opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={prefersReducedMotion ? {} : { opacity: 0, x: -20 }}
      role="region"
      aria-label={`Stop: ${stop.name}`}
    >
      <div className="px-5 pt-5 pb-4 border-b border-border/40">
        <div className="flex items-center gap-3">
          <motion.button
            whileHover={prefersReducedMotion ? {} : { scale: 1.08 }}
            whileTap={prefersReducedMotion ? {} : { scale: 0.93 }}
            onClick={onBack}
            className="touch-target-lg h-10 w-10 rounded-full bg-secondary flex items-center justify-center hover:bg-accent transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
            aria-label="Back"
          >
            <CaretLeft size={20} weight="bold" className="text-foreground" />
          </motion.button>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-foreground text-balance">{stop.name}</h2>
            <WalkingDistance minutes={stop.walkingDistance} meters={stop.walkingMeters} />
          </div>
        </div>
      </div>

      <Section label="Upcoming Arrivals" className="mt-4 mb-4">
        {arrivals.length > 0 ? (
          <ul className="space-y-2 px-5" role="list">
            {arrivals.map((arrival, i) => (
              <motion.li
                key={arrival.id}
                initial={prefersReducedMotion ? {} : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <ETACard arrival={arrival} compact />
              </motion.li>
            ))}
          </ul>
        ) : (
          <div className="px-5"><EmptyState title="No upcoming buses" message="Checking arrivals at this stop…" /></div>
        )}
      </Section>
    </motion.div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// MOBILE LAYOUT — Thumb-first, commuter-optimized
// ═══════════════════════════════════════════════════════════════════════════
function MobileLayout({
  arrivals, nearbyStops, buses, isLoading, isRefreshing, lastRefresh,
  userLocation, selectedStop, stopArrivals, onRefresh, onStopSelect, onBack,
  prefersReducedMotion, dynamicStops
}: LayoutProps & { dynamicStops?: BusStop[] }) {
  return (
    <div className="relative h-screen w-full overflow-hidden">
      {/* Map (Background) */}
      <div className="absolute inset-0 z-0">
        <MapboxTransitMap 
          buses={buses} 
          stops={kigaliStops} 
          routeGeometries={kigaliRouteGeometries} 
          userLocation={userLocation || undefined}
          selectedStopId={selectedStop?.id}
          onStopClick={onStopSelect}
        />
      </div>

      {/* Gradient fade behind the bottom sheet edge */}
      {/* Header Overlay for Mobile Map */}
      <div className="absolute top-0 left-0 right-0 p-4 z-40 bg-gradient-to-b from-black/20 to-transparent pointer-events-none" />
      <div className="absolute top-6 left-4 right-4 z-50 pointer-events-auto flex items-center gap-3">
        <SearchBar onStopSelect={onStopSelect} className="w-full shadow-lg" />
        <Link href="/settings" aria-label="Settings">
          <motion.div
            whileTap={{ scale: 0.95 }}
            className="h-12 w-12 shrink-0 rounded-full bg-card border border-border/50 shadow-lg flex items-center justify-center text-foreground hover:bg-secondary transition-colors"
          >
            <Gear size={22} weight="fill" />
          </motion.div>
        </Link>
      </div>
      <div
        className="absolute bottom-0 left-0 right-0 pointer-events-none z-40"
        style={{ height: '18vh' }}
        aria-hidden="true"
      >
        <div className="map-bottom-fade absolute inset-0" />
      </div>

      {/* Bottom sheet */}
      <BottomSheet defaultHeight={45} minHeight={30} maxHeight={85}>
        <AnimatePresence mode="wait">
          {selectedStop ? (
            <MobileStopDetailPanel
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

// Mobile: Home content
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
  arrivals, nearbyStops, isLoading, isRefreshing, lastRefresh,
  onRefresh, onStopSelect, prefersReducedMotion,
}: MobileHomeContentProps) {
  if (isLoading) return <LoadingState message="Finding nearby buses…" />

  return (
    <motion.div
      initial={prefersReducedMotion ? {} : { opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={prefersReducedMotion ? {} : { opacity: 0, y: -20 }}
      className="px-4 space-y-5"
      role="main"
    >
      {/* Thumb-reachable header */}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground leading-none">Nearby Buses</h1>
          {lastRefresh && (
            <p className="text-sm text-muted-foreground mt-1">{formatTimeAgo(lastRefresh)}</p>
          )}
        </div>
        <motion.button
          whileHover={prefersReducedMotion ? {} : { scale: 1.06 }}
          whileTap={prefersReducedMotion ? {} : { scale: 0.94 }}
          onClick={onRefresh}
          disabled={isRefreshing}
          className="touch-target h-11 w-11 rounded-full bg-secondary flex items-center justify-center hover:bg-accent transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary"
          aria-label={isRefreshing ? 'Refreshing…' : 'Refresh bus data'}
        >
          <ArrowClockwise size={20} weight="bold" className={cn('text-foreground', isRefreshing && 'animate-spin')} aria-hidden="true" />
        </motion.button>
      </header>

      {/* Quick tip */}
      <div className="flex items-start gap-2 px-3 py-2.5 bg-secondary rounded-xl border border-border/50">
        <Info size={14} weight="duotone" className="text-primary mt-0.5 shrink-0" aria-hidden="true" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          Tap a stop on the map or below to see all arriving buses.
        </p>
      </div>

      {/* Arrivals */}
      <section className="space-y-2.5" aria-labelledby="mobile-arrivals-heading">
        <h2 id="mobile-arrivals-heading" className="section-label">Arriving Soon</h2>
        {arrivals.length > 0 ? (
          <ul className="space-y-2" role="list">
            {arrivals.slice(0, 5).map((arrival, i) => (
              <motion.li
                key={arrival.id}
                initial={prefersReducedMotion ? {} : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <ETACard arrival={arrival} onPress={() => onStopSelect(arrival.stop)} />
              </motion.li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No buses nearby" message="Pull to refresh or move closer to a stop." />
        )}
      </section>

      {/* Nearby stops */}
      <section className="space-y-1.5" aria-labelledby="mobile-stops-heading">
        <h2 id="mobile-stops-heading" className="section-label">Nearby Stops</h2>
        <ul className="space-y-0.5" role="list">
          {nearbyStops.slice(0, 5).map((stop, i) => (
            <motion.li
              key={stop.id}
              initial={prefersReducedMotion ? {} : { opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 + i * 0.04 }}
            >
              <NearbyStopRow stop={stop} onPress={() => onStopSelect(stop)} />
            </motion.li>
          ))}
        </ul>
      </section>

      {/* Routes */}
      <section className="space-y-2 pb-6" aria-labelledby="mobile-routes-heading">
        <h2 id="mobile-routes-heading" className="section-label">Routes</h2>
        <ul className="space-y-2" role="list">
          {kigaliRoutes.slice(0, 4).map((route, i) => (
            <motion.li
              key={route.id}
              initial={prefersReducedMotion ? {} : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + i * 0.05 }}
            >
              <RouteCard routeName={route.name} color={route.color} destinations={route.destinations} />
            </motion.li>
          ))}
        </ul>
      </section>
    </motion.div>
  )
}

// Mobile: Stop detail panel
interface MobileStopDetailPanelProps {
  stop: BusStop
  arrivals: Arrival[]
  onBack: () => void
  prefersReducedMotion: boolean
}

function MobileStopDetailPanel({ stop, arrivals, onBack, prefersReducedMotion }: MobileStopDetailPanelProps) {
  return (
    <motion.div
      initial={prefersReducedMotion ? {} : { opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={prefersReducedMotion ? {} : { opacity: 0, x: -24 }}
      className="px-4 pb-6"
      role="region"
      aria-label={`Stop: ${stop.name}`}
    >
      <header className="flex items-center gap-3 mb-5">
        <motion.button
          whileHover={prefersReducedMotion ? {} : { scale: 1.06 }}
          whileTap={prefersReducedMotion ? {} : { scale: 0.94 }}
          onClick={onBack}
          className="touch-target h-11 w-11 rounded-full bg-secondary flex items-center justify-center hover:bg-accent transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
          aria-label="Go back to all stops"
        >
          <CaretLeft size={20} weight="bold" className="text-foreground" />
        </motion.button>
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold text-foreground text-balance leading-tight">{stop.name}</h2>
          <WalkingDistance minutes={stop.walkingDistance} meters={stop.walkingMeters} />
        </div>
      </header>

      <section className="space-y-2" aria-labelledby="stop-arrivals-heading">
        <div className="flex items-center gap-2 mb-1">
          <Clock size={13} weight="duotone" className="text-muted-foreground" aria-hidden="true" />
          <h3 id="stop-arrivals-heading" className="section-label">Upcoming Arrivals</h3>
        </div>
        {arrivals.length > 0 ? (
          <ul className="space-y-2" role="list">
            {arrivals.map((arrival, i) => (
              <motion.li
                key={arrival.id}
                initial={prefersReducedMotion ? {} : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <ETACard arrival={arrival} compact />
              </motion.li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No upcoming buses" message="Checking for arrivals at this stop…" />
        )}
      </section>
    </motion.div>
  )
}

// ─── Shared Section component ──────────────────────────────────────────────
function Section({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-2', className)} aria-labelledby={`section-${label.toLowerCase().replace(/\s+/g, '-')}`}>
      <h2
        id={`section-${label.toLowerCase().replace(/\s+/g, '-')}`}
        className="section-label px-5"
      >
        {label}
      </h2>
      {children}
    </section>
  )
}

export default ResponsiveApp
