'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { motion, AnimatePresence } from 'framer-motion'
import { Navigation, Minus, Plus, Layers } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Bus as BusType, BusStop, RouteGeometry } from '@/lib/types'
import { KIGALI_CENTER } from '@/lib/mock-data'

interface MapboxTransitMapProps {
  buses: BusType[]
  stops: BusStop[]
  routeGeometries: RouteGeometry[]
  userLocation?: { lat: number; lng: number }
  selectedStopId?: string | null
  onStopClick?: (stop: BusStop) => void
  onBusClick?: (bus: BusType) => void
  className?: string
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
}: MapboxTransitMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const busMarkersRef = useRef<Map<string, HTMLDivElement>>(new Map())
  const stopMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map())
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null)
  const [isMapReady, setIsMapReady] = useState(false)
  const [mapBearing, setMapBearing] = useState(0)

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return

    const accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN
    if (!accessToken) {
      console.error('[v0] Mapbox access token not found')
      return
    }

    mapboxgl.accessToken = accessToken

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [userLocation?.lng || KIGALI_CENTER.lng, userLocation?.lat || KIGALI_CENTER.lat],
      zoom: 14,
      pitch: 0,
      bearing: 0,
      maxZoom: 18,
      minZoom: 11,
      attributionControl: false,
    })

    map.current.on('load', () => {
      setIsMapReady(true)
      
      // Add route lines source and layer
      map.current?.addSource('routes', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [],
        },
      })

      map.current?.addLayer({
        id: 'routes-layer',
        type: 'line',
        source: 'routes',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': '#4ECDC4',
          'line-width': 4,
          'line-opacity': 0.5,
        },
      })
    })

    // Track map rotation for counter-rotating icons
    map.current.on('rotate', () => {
      if (map.current) {
        setMapBearing(map.current.getBearing())
      }
    })

    return () => {
      map.current?.remove()
      map.current = null
    }
  }, [userLocation])

  // Update route geometries
  useEffect(() => {
    if (!map.current || !isMapReady) return

    const routeSource = map.current.getSource('routes') as mapboxgl.GeoJSONSource
    if (routeSource) {
      const features = routeGeometries.map((route) => ({
        type: 'Feature' as const,
        properties: { routeId: route.routeId },
        geometry: {
          type: 'LineString' as const,
          coordinates: route.coordinates,
        },
      }))

      routeSource.setData({
        type: 'FeatureCollection',
        features,
      })
    }
  }, [routeGeometries, isMapReady])

  // Update stop markers
  useEffect(() => {
    if (!map.current || !isMapReady) return

    // Remove old markers
    stopMarkersRef.current.forEach((marker) => marker.remove())
    stopMarkersRef.current.clear()

    // Add new markers
    stops.forEach((stop) => {
      const el = createStopMarkerElement(stop, stop.id === selectedStopId)
      
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        onStopClick?.(stop)
      })

      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([stop.longitude, stop.latitude])
        .addTo(map.current!)

      stopMarkersRef.current.set(stop.id, marker)
    })
  }, [stops, selectedStopId, onStopClick, isMapReady])

  // Update bus markers with rotation
  useEffect(() => {
    if (!map.current || !isMapReady) return

    buses.forEach((bus) => {
      let markerEl = busMarkersRef.current.get(bus.id)

      if (!markerEl) {
        // Create new bus marker
        markerEl = createBusMarkerElement(bus, mapBearing)
        markerEl.addEventListener('click', (e) => {
          e.stopPropagation()
          onBusClick?.(bus)
        })
        
        const marker = new mapboxgl.Marker({ element: markerEl, anchor: 'center', rotationAlignment: 'map' })
          .setLngLat([bus.currentPosition.longitude, bus.currentPosition.latitude])
          .addTo(map.current!)

        busMarkersRef.current.set(bus.id, markerEl)
      } else {
        // Update existing marker position smoothly
        const marker = Array.from(stopMarkersRef.current.values()).find(
          (m) => m.getElement() === markerEl
        )
        
        // Update position via CSS transform for smooth animation
        markerEl.style.transform = `rotate(${bus.heading - mapBearing}deg)`
        
        // Update the internal rotation
        const busIcon = markerEl.querySelector('.bus-direction') as HTMLElement
        if (busIcon) {
          busIcon.style.transform = `rotate(${-mapBearing}deg)`
        }
      }
    })
  }, [buses, mapBearing, onBusClick, isMapReady])

  // Update user location marker
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

  // Center on user
  const centerOnUser = useCallback(() => {
    if (map.current && userLocation) {
      map.current.flyTo({
        center: [userLocation.lng, userLocation.lat],
        zoom: 15,
        duration: 1000,
        essential: true,
      })
    }
  }, [userLocation])

  // Zoom controls
  const zoomIn = useCallback(() => {
    map.current?.zoomIn({ duration: 300 })
  }, [])

  const zoomOut = useCallback(() => {
    map.current?.zoomOut({ duration: 300 })
  }, [])

  // Reset bearing
  const resetBearing = useCallback(() => {
    map.current?.rotateTo(0, { duration: 500 })
  }, [])

  return (
    <div className={cn('relative', className)}>
      {/* Map container */}
      <div ref={mapContainer} className="absolute inset-0" />

      {/* Loading state */}
      <AnimatePresence>
        {!isMapReady && (
          <motion.div
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-background flex items-center justify-center"
          >
            <div className="flex flex-col items-center gap-3">
              <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              <p className="text-sm text-muted-foreground">Loading map...</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Map controls */}
      <div 
        className="absolute bottom-4 right-4 flex flex-col gap-2"
        role="group"
        aria-label="Map controls"
      >
        {/* Zoom controls */}
        <div className="flex flex-col bg-card/90 backdrop-blur-sm rounded-xl shadow-lg overflow-hidden">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={zoomIn}
            className="h-11 w-11 flex items-center justify-center hover:bg-accent transition-colors border-b border-border"
            aria-label="Zoom in"
          >
            <Plus className="h-5 w-5 text-foreground" />
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={zoomOut}
            className="h-11 w-11 flex items-center justify-center hover:bg-accent transition-colors"
            aria-label="Zoom out"
          >
            <Minus className="h-5 w-5 text-foreground" />
          </motion.button>
        </div>

        {/* Reset bearing */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={resetBearing}
          className={cn(
            'h-11 w-11 rounded-xl bg-card/90 backdrop-blur-sm shadow-lg flex items-center justify-center hover:bg-accent transition-all',
            mapBearing !== 0 && 'ring-2 ring-primary'
          )}
          style={{ transform: `rotate(${-mapBearing}deg)` }}
          aria-label="Reset map orientation"
        >
          <Layers className="h-5 w-5 text-foreground" />
        </motion.button>

        {/* Center on user */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={centerOnUser}
          className="h-11 w-11 rounded-xl bg-card/90 backdrop-blur-sm shadow-lg flex items-center justify-center hover:bg-accent transition-colors"
          aria-label="Center on your location"
        >
          <Navigation className="h-5 w-5 text-primary" />
        </motion.button>
      </div>

      {/* Attribution */}
      <div className="absolute bottom-2 left-2 text-[10px] text-muted-foreground/60">
        Mapbox
      </div>
    </div>
  )
}

// Create stop marker element
function createStopMarkerElement(stop: BusStop, isSelected: boolean): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'stop-marker'
  el.setAttribute('role', 'button')
  el.setAttribute('aria-label', `Bus stop: ${stop.name}`)
  el.setAttribute('tabindex', '0')
  
  el.innerHTML = `
    <div class="relative flex items-center justify-center cursor-pointer transition-transform hover:scale-110 active:scale-95">
      ${isSelected ? `
        <div class="absolute inset-0 rounded-full bg-primary animate-ping opacity-30"></div>
        <div class="h-8 w-8 rounded-full bg-primary shadow-lg shadow-primary/50 flex items-center justify-center">
          <svg class="h-4 w-4 text-primary-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
            <circle cx="12" cy="10" r="3"></circle>
          </svg>
        </div>
      ` : `
        <div class="h-7 w-7 rounded-full bg-card border-2 border-primary/60 shadow-md flex items-center justify-center">
          <svg class="h-3.5 w-3.5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
            <circle cx="12" cy="10" r="3"></circle>
          </svg>
        </div>
      `}
    </div>
  `
  
  return el
}

// Create bus marker element with direction arrow
function createBusMarkerElement(bus: BusType, mapBearing: number): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'bus-marker'
  el.setAttribute('role', 'button')
  el.setAttribute('aria-label', `Bus ${bus.routeName} heading to ${bus.destination}`)
  el.setAttribute('tabindex', '0')
  
  // Bus icon that rotates with heading but counter-rotates against map bearing
  const rotation = bus.heading - mapBearing
  
  el.innerHTML = `
    <div class="relative flex items-center justify-center cursor-pointer" style="transform: rotate(${rotation}deg)">
      <div class="bus-direction relative">
        <!-- Direction arrow (points direction of travel) -->
        <div class="absolute -top-2 left-1/2 -translate-x-1/2 w-0 h-0" style="
          border-left: 6px solid transparent;
          border-right: 6px solid transparent;
          border-bottom: 10px solid hsl(var(--primary));
          filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));
        "></div>
        
        <!-- Bus body -->
        <div class="h-10 w-10 rounded-xl bg-primary shadow-lg shadow-primary/40 flex items-center justify-center transition-transform hover:scale-110 active:scale-95">
          <svg class="h-5 w-5 text-primary-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 6v6"></path>
            <path d="M15 6v6"></path>
            <path d="M2 12h19.6"></path>
            <path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"></path>
            <circle cx="7" cy="18" r="2"></circle>
            <path d="M9 18h5"></path>
            <circle cx="16" cy="18" r="2"></circle>
          </svg>
        </div>
        
        <!-- Route badge -->
        <div class="absolute -bottom-1 -right-1 h-5 min-w-5 px-1 rounded-full bg-card text-[10px] font-bold flex items-center justify-center border border-border shadow-sm" style="transform: rotate(${-rotation}deg)">
          ${bus.routeName}
        </div>
      </div>
    </div>
  `
  
  return el
}

// Create user location marker
function createUserMarkerElement(): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'user-marker'
  el.setAttribute('role', 'img')
  el.setAttribute('aria-label', 'Your location')
  
  el.innerHTML = `
    <div class="relative flex items-center justify-center">
      <!-- Pulse rings -->
      <div class="absolute h-8 w-8 rounded-full bg-blue-500/30 animate-ping"></div>
      <div class="absolute h-6 w-6 rounded-full bg-blue-500/20 animate-pulse"></div>
      <!-- Center dot -->
      <div class="h-4 w-4 rounded-full bg-blue-500 border-2 border-white shadow-lg"></div>
    </div>
  `
  
  return el
}

export default MapboxTransitMap
