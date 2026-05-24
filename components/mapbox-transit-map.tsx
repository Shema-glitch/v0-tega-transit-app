'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import { motion, AnimatePresence } from 'framer-motion'
import { useTheme } from 'next-themes'
import { cn } from '@/lib/utils'
import { Bus as BusType, BusStop, RouteGeometry } from '@/lib/types'
import { KIGALI_CENTER } from '@/lib/mock-data'

// Phosphor icons via SVG strings (used inside createElementHTML helpers)
const TEAL = '#4ECDC4'
const TEAL_DARK = '#1a2a28'

interface MapboxTransitMapProps {
  buses: BusType[]
  stops: BusStop[]
  routeGeometries: RouteGeometry[]
  userLocation?: { lat: number; lng: number }
  selectedStopId?: string | null
  onStopClick?: (stop: BusStop) => void
  onBusClick?: (bus: BusType) => void
  className?: string
  dynamicStops?: BusStop[]
}

export function MapboxTransitMap({
  buses,
  stops,
  routeGeometries,
  userLocation,
  selectedStopId,
  onStopClick,
  onBusClick,
  className,
  dynamicStops = []
}: MapboxTransitMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const busMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map())
  const stopMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map())
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null)
  const [isMapReady, setIsMapReady] = useState(false)
  const [mapBearing, setMapBearing] = useState(0)
  const [mapError, setMapError] = useState<string | null>(null)

  const { resolvedTheme } = useTheme()
  // Force dark map style for a premium, calm mobility experience
  const mapStyle = 'mapbox://styles/mapbox/dark-v11'

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return

    const accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN
    if (!accessToken) {
      setMapError('Mapbox access token not configured.')
      return
    }

    try {
      mapboxgl.accessToken = accessToken

      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: mapStyle,  /* daylight-readable map */
        center: [KIGALI_CENTER.lng, KIGALI_CENTER.lat],
        zoom: 13.5,
        pitch: 0,
        bearing: 0,
        maxZoom: 18,
        minZoom: 10,
        attributionControl: false,
        logoPosition: 'bottom-left',
      })

      map.current.on('load', () => {
        setIsMapReady(true)

        // Route lines
        map.current?.addSource('routes', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        })

        map.current?.addLayer({
          id: 'routes-layer',
          type: 'line',
          source: 'routes',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#00a896',   /* Tega primary teal on light map */
            'line-width': 5,
            'line-opacity': 0.65,
          },
        })
      })

      map.current.on('error', (e) => {
        console.error('[Mapbox] Error:', e.error?.message)
        setMapError('Map failed to load. Check your Mapbox token.')
      })

      map.current.on('rotate', () => {
        if (map.current) setMapBearing(map.current.getBearing())
      })
    } catch (err) {
      setMapError('Failed to initialize map.')
      console.error(err)
    }

    return () => {
      map.current?.remove()
      map.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Update route geometries
  useEffect(() => {
    if (!map.current || !isMapReady) return
    const routeSource = map.current.getSource('routes') as mapboxgl.GeoJSONSource
    if (routeSource) {
      routeSource.setData({
        type: 'FeatureCollection',
        features: routeGeometries.map((route) => ({
          type: 'Feature' as const,
          properties: { routeId: route.routeId },
          geometry: { type: 'LineString' as const, coordinates: route.coordinates },
        })),
      })
    }
  }, [routeGeometries, isMapReady])

  // Update stop markers
  useEffect(() => {
    if (!map.current || !isMapReady) return

    stopMarkersRef.current.forEach((marker) => marker.remove())
    stopMarkersRef.current.clear()

    const markersToRender = dynamicStops.length > 0 ? dynamicStops : stops

    markersToRender.forEach((stop) => {
      const el = createStopMarkerElement(stop.id === selectedStopId)
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        onStopClick?.(stop)
      })
      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([stop.longitude, stop.latitude])
        .addTo(map.current!)
      stopMarkersRef.current.set(stop.id, marker)
    })
  }, [stops, dynamicStops, selectedStopId, onStopClick, isMapReady])

  // Update bus markers
  useEffect(() => {
    if (!map.current || !isMapReady) return

    buses.forEach((bus) => {
      const existing = busMarkersRef.current.get(bus.id)
      if (existing) {
        existing.setLngLat([bus.currentPosition.longitude, bus.currentPosition.latitude])
        // Update rotation on element
        const inner = existing.getElement().querySelector<HTMLElement>('.bus-inner')
        if (inner) inner.style.transform = `rotate(${bus.heading - mapBearing}deg)`
      } else {
        const el = createBusMarkerElement(bus.routeName, bus.heading - mapBearing)
        el.addEventListener('click', (e) => {
          e.stopPropagation()
          onBusClick?.(bus)
        })
        const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat([bus.currentPosition.longitude, bus.currentPosition.latitude])
          .addTo(map.current!)
        busMarkersRef.current.set(bus.id, marker)
      }
    })
  }, [buses, mapBearing, onBusClick, isMapReady])

  // User location marker
  useEffect(() => {
    if (!map.current || !isMapReady || !userLocation) return
    if (!userMarkerRef.current) {
      const el = createUserMarkerElement()
      userMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([userLocation.lng, userLocation.lat])
        .addTo(map.current)
    } else {
      userMarkerRef.current.setLngLat([userLocation.lng, userLocation.lat])
    }
  }, [userLocation, isMapReady])

  // Update map style when theme changes
  useEffect(() => {
    if (map.current && isMapReady) {
      map.current.setStyle(mapStyle)
    }
  }, [mapStyle, isMapReady])

  const centerOnUser = useCallback(() => {
    if (map.current && userLocation) {
      map.current.flyTo({ center: [userLocation.lng, userLocation.lat], zoom: 15, duration: 900, essential: true })
    }
  }, [userLocation])

  const zoomIn = useCallback(() => map.current?.zoomIn({ duration: 280 }), [])
  const zoomOut = useCallback(() => map.current?.zoomOut({ duration: 280 }), [])
  const resetBearing = useCallback(() => map.current?.rotateTo(0, { duration: 450 }), [])

  return (
    <div className={cn('relative', className)}>
      {/* Map container */}
      <div ref={mapContainer} className="absolute inset-0" />

      {/* Loading overlay */}
      <AnimatePresence>
        {(!isMapReady && !mapError) && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          className="absolute inset-0 bg-[#000000] flex items-center justify-center z-10"
        >
          {/* Shimmer loading for map */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-[#0a1118] to-black z-0" />
          <div className="relative z-10 flex flex-col items-center gap-3">
            <div className="h-8 w-8 rounded-full border-2 border-[#00a896] border-t-transparent animate-spin" />
            <p className="text-xs font-medium text-muted-foreground animate-pulse">Loading transit map...</p>
          </div>
        </motion.div>
      )}
      </AnimatePresence>

      {/* Error overlay */}
      {mapError && (
        <div className="absolute inset-0 bg-background flex items-center justify-center z-10">
          <div className="text-center px-6">
            <div className="h-12 w-12 rounded-xl bg-muted flex items-center justify-center mx-auto mb-3">
              <svg width="24" height="24" viewBox="0 0 256 256" fill="currentColor" className="text-muted-foreground">
                <path d="M236.8,188.09,149.35,36.22a24.76,24.76,0,0,0-42.7,0L19.2,188.09a23.51,23.51,0,0,0,0,23.72A24.35,24.35,0,0,0,40.55,224h174.9a24.35,24.35,0,0,0,21.33-12.19A23.51,23.51,0,0,0,236.8,188.09ZM120,104a8,8,0,0,1,16,0v40a8,8,0,0,1-16,0Zm8,88a12,12,0,1,1,12-12A12,12,0,0,1,128,192Z"/>
              </svg>
            </div>
            <p className="text-sm font-medium text-foreground mb-1">Map unavailable</p>
            <p className="text-xs text-muted-foreground max-w-[220px]">{mapError}</p>
          </div>
        </div>
      )}

      {/* Map controls — top right */}
      {isMapReady && (
        <div
          className="absolute right-4 top-20 flex flex-col gap-2"
          role="group"
          aria-label="Map controls"
        >
          {/* Zoom */}
          <div className="flex flex-col overflow-hidden rounded-xl border-2 border-border bg-card shadow-[0_4px_16px_rgba(0,0,0,0.16)]">
            <button
              onClick={zoomIn}
              className="h-10 w-10 flex items-center justify-center hover:bg-secondary transition-colors border-b-2 border-border"
              aria-label="Zoom in"
            >
              {/* Phosphor Plus icon */}
              <svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" className="text-foreground">
                <path d="M228,128a12,12,0,0,1-12,12H140v76a12,12,0,0,1-24,0V140H40a12,12,0,0,1,0-24h76V40a12,12,0,0,1,24,0v76h76A12,12,0,0,1,228,128Z"/>
              </svg>
            </button>
            <button
              onClick={zoomOut}
              className="h-10 w-10 flex items-center justify-center hover:bg-secondary transition-colors"
              aria-label="Zoom out"
            >
              {/* Phosphor Minus icon */}
              <svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" className="text-foreground">
                <path d="M228,128a12,12,0,0,1-12,12H40a12,12,0,0,1,0-24H216A12,12,0,0,1,228,128Z"/>
              </svg>
            </button>
          </div>

          {/* Center on user */}
          <button
            onClick={centerOnUser}
            className="h-10 w-10 rounded-xl border-2 border-border bg-card shadow-[0_4px_16px_rgba(0,0,0,0.16)] flex items-center justify-center hover:bg-secondary transition-colors"
            aria-label="Center on your location"
          >
            {/* Phosphor Crosshair icon */}
            <svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" className="text-primary">
              <path d="M229.19,120H204.92A76.26,76.26,0,0,0,136,51.08V26.81a12,12,0,0,0-24,0V51.08A76.26,76.26,0,0,0,43.08,120H18.81a12,12,0,0,0,0,24H43.08A76.26,76.26,0,0,0,112,229.19V253.19a12,12,0,0,0,24,0V229.19A76.26,76.26,0,0,0,204.92,144h24.27a12,12,0,0,0,0-24ZM128,204a76,76,0,1,1,76-76A76.08,76.08,0,0,1,128,204Zm0-120a44,44,0,1,0,44,44A44.05,44.05,0,0,0,128,84Zm0,64a20,20,0,1,1,20-20A20,20,0,0,1,128,148Z"/>
            </svg>
          </button>

          {/* Reset bearing */}
          {mapBearing !== 0 && (
            <button
              onClick={resetBearing}
              className="h-10 w-10 rounded-xl border-2 border-primary/60 bg-card shadow-[0_4px_16px_rgba(0,0,0,0.16)] flex items-center justify-center hover:bg-secondary transition-colors"
              aria-label="Reset map orientation"
              title="Reset north"
            >
              {/* Phosphor Compass icon */}
              <svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" className="text-foreground" style={{ transform: `rotate(${-mapBearing}deg)` }}>
                <path d="M232,128A104,104,0,1,1,128,24,104.11,104.11,0,0,1,232,128Zm-24,0a80,80,0,1,0-80,80A80.09,80.09,0,0,0,208,128ZM142.48,80.48l-48,96a12,12,0,0,1-15.76,5.44,12,12,0,0,1-5.44-15.76l48-96a12,12,0,0,1,21.2,11.32Z"/>
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Marker creators — use literal hex colors (no CSS vars) ──────────────────

function createStopMarkerElement(isSelected: boolean): HTMLDivElement {
  const el = document.createElement('div')
  el.style.cursor = 'pointer'
  el.setAttribute('role', 'button')
  el.setAttribute('tabindex', '0')
  el.style.transition = 'transform 0.4s ease-out'

  if (isSelected) {
    el.innerHTML = `
      <div style="position:relative;display:flex;align-items:center;justify-content:center;width:36px;height:36px;">
        <div style="position:absolute;inset:0;border-radius:50%;background:${TEAL};opacity:0.25;animation:ping 1.2s cubic-bezier(0,0,0.2,1) infinite;"></div>
        <div style="width:32px;height:32px;border-radius:50%;background:${TEAL};display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 3px ${TEAL}33;">
          <svg width="14" height="14" viewBox="0 0 256 256" fill="${TEAL_DARK}">
            <path d="M128,16a96,96,0,1,0,96,96A96.11,96.11,0,0,0,128,16Zm0,168a72,72,0,1,1,72-72A72.08,72.08,0,0,1,128,184Zm0-112a40,40,0,1,0,40,40A40,40,0,0,0,128,72Zm0,56a16,16,0,1,1,16-16A16,16,0,0,1,128,128Z"/>
          </svg>
        </div>
      </div>
    `
  } else {
    el.innerHTML = `
      <div style="width:26px;height:26px;border-radius:50%;background:#1a2228;border:2px solid ${TEAL}99;display:flex;align-items:center;justify-content:center;transition:transform 0.15s ease;" onmouseenter="this.style.transform='scale(1.15)'" onmouseleave="this.style.transform='scale(1)'">
        <svg width="11" height="11" viewBox="0 0 256 256" fill="${TEAL}">
          <path d="M128,16a96,96,0,1,0,96,96A96.11,96.11,0,0,0,128,16Zm0,168a72,72,0,1,1,72-72A72.08,72.08,0,0,1,128,184Zm0-112a40,40,0,1,0,40,40A40,40,0,0,0,128,72Zm0,56a16,16,0,1,1,16-16A16,16,0,0,1,128,128Z"/>
        </svg>
      </div>
    `
  }
  return el
}

function createBusMarkerElement(routeName: string, initialRotation: number): HTMLDivElement {
  const el = document.createElement('div')
  el.style.cursor = 'pointer'
  el.style.transition = 'transform 1s linear'

  el.innerHTML = `
    <div class="bus-inner" style="transform:rotate(${initialRotation}deg);display:flex;flex-direction:column;align-items:center;gap:2px;transition:transform 1.8s cubic-bezier(0.25,0.1,0.25,1);">
      <!-- Direction chevron -->
      <div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:9px solid ${TEAL};filter:drop-shadow(0 1px 2px rgba(0,0,0,0.5));"></div>
      <!-- Bus body -->
      <div style="width:38px;height:38px;border-radius:10px;background:${TEAL};display:flex;align-items:center;justify-content:center;box-shadow:0 2px 12px ${TEAL}55;position:relative;">
        <svg width="18" height="18" viewBox="0 0 256 256" fill="${TEAL_DARK}">
          <path d="M254,98.93l-6-48A20,20,0,0,0,228.23,32H27.77A20,20,0,0,0,8,50.93l-6,48A20.07,20.07,0,0,0,2,100V208a20,20,0,0,0,20,20H52a20,20,0,0,0,20-20V196h112v12a20,20,0,0,0,20,20h30a20,20,0,0,0,20-20V100A20.07,20.07,0,0,0,254,98.93ZM76,172a16,16,0,1,1,16-16A16,16,0,0,1,76,172Zm104,0a16,16,0,1,1,16-16A16,16,0,0,1,180,172Z"/>
        </svg>
        <!-- Route badge -->
        <div style="position:absolute;bottom:-6px;right:-6px;min-width:18px;height:18px;padding:0 4px;border-radius:9px;background:#111827;border:1.5px solid #374151;font-size:8px;font-weight:700;color:#f9fafb;display:flex;align-items:center;justify-content:center;font-family:system-ui;">
          ${routeName}
        </div>
      </div>
    </div>
  `
  return el
}

function createUserMarkerElement(): HTMLDivElement {
  const el = document.createElement('div')
  el.setAttribute('role', 'img')
  el.setAttribute('aria-label', 'Your location')
  el.style.transition = 'transform 1s ease-out'

  el.innerHTML = `
    <div style="position:relative;width:20px;height:20px;display:flex;align-items:center;justify-content:center;">
      <div style="position:absolute;inset:0;border-radius:50%;background:#3b82f655;animation:ping 2s cubic-bezier(0,0,0.2,1) infinite;"></div>
      <div style="position:absolute;width:28px;height:28px;border-radius:50%;background:#3b82f620;"></div>
      <div style="width:14px;height:14px;border-radius:50%;background:#3b82f6;border:2.5px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4);"></div>
    </div>
  `
  return el
}

export default MapboxTransitMap
