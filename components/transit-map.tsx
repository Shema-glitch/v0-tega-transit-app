'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { GoogleMap, useJsApiLoader, Marker, Polyline, OverlayView } from '@react-google-maps/api'
import { motion, AnimatePresence } from 'framer-motion'
import { Bus, MapPin, NavigationArrow } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { Bus as BusType, BusStop, RouteGeometry } from '@/lib/types'
import { KIGALI_CENTER } from '@/lib/mock-data'
import { MapSkeleton } from './skeletons'

// Dark mode map styles
const darkMapStyles: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#1a1a2e' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1a1a2e' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6b7280' }] },
  {
    featureType: 'administrative',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#2d2d44' }],
  },
  {
    featureType: 'administrative.land_parcel',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#4b5563' }],
  },
  {
    featureType: 'poi',
    elementType: 'geometry',
    stylers: [{ color: '#22223b' }],
  },
  {
    featureType: 'poi',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#6b7280' }],
  },
  {
    featureType: 'poi.park',
    elementType: 'geometry',
    stylers: [{ color: '#1e3a2f' }],
  },
  {
    featureType: 'poi.park',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#4ade80' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#2d2d44' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#1a1a2e' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry',
    stylers: [{ color: '#3d3d5c' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#1a1a2e' }],
  },
  {
    featureType: 'transit',
    elementType: 'geometry',
    stylers: [{ color: '#2f2f4f' }],
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#0e1a2b' }],
  },
  {
    featureType: 'water',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#4b5563' }],
  },
]

const mapContainerStyle = {
  width: '100%',
  height: '100%',
}

const defaultMapOptions: google.maps.MapOptions = {
  styles: darkMapStyles,
  disableDefaultUI: true,
  zoomControl: false,
  mapTypeControl: false,
  streetViewControl: false,
  fullscreenControl: false,
  clickableIcons: false,
  gestureHandling: 'greedy',
  minZoom: 12,
  maxZoom: 18,
}

interface TransitMapProps {
  buses: BusType[]
  stops: BusStop[]
  routeGeometries: RouteGeometry[]
  userLocation?: { lat: number; lng: number }
  selectedStopId?: string | null
  onStopClick?: (stop: BusStop) => void
  onBusClick?: (bus: BusType) => void
  className?: string
}

export function TransitMap({
  buses,
  stops,
  routeGeometries,
  userLocation,
  selectedStopId,
  onStopClick,
  onBusClick,
  className,
}: TransitMapProps) {
  const mapRef = useRef<google.maps.Map | null>(null)
  const [isMapReady, setIsMapReady] = useState(false)

  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '',
  })

  const onMapLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map
    setIsMapReady(true)
  }, [])

  const centerOnUser = useCallback(() => {
    if (mapRef.current && userLocation) {
      mapRef.current.panTo(userLocation)
      mapRef.current.setZoom(15)
    }
  }, [userLocation])

  // Center map on user location when available
  useEffect(() => {
    if (isMapReady && userLocation) {
      mapRef.current?.panTo(userLocation)
    }
  }, [isMapReady, userLocation])

  if (loadError) {
    return (
      <div className={cn('flex items-center justify-center bg-background', className)}>
        <p className="text-muted-foreground">Unable to load map</p>
      </div>
    )
  }

  if (!isLoaded) {
    return <MapSkeleton />
  }

  return (
    <div className={cn('relative', className)}>
      <GoogleMap
        mapContainerStyle={mapContainerStyle}
        center={userLocation || KIGALI_CENTER}
        zoom={14}
        options={defaultMapOptions}
        onLoad={onMapLoad}
      >
        {/* Route polylines */}
        {routeGeometries.map((route) => (
          <Polyline
            key={route.routeId}
            path={route.coordinates.map(([lng, lat]) => ({ lat, lng }))}
            options={{
              strokeColor: '#4ECDC4',
              strokeOpacity: 0.4,
              strokeWeight: 4,
              geodesic: true,
            }}
          />
        ))}

        {/* Stop markers */}
        {stops.map((stop) => (
          <StopMarker
            key={stop.id}
            stop={stop}
            isSelected={stop.id === selectedStopId}
            onClick={() => onStopClick?.(stop)}
          />
        ))}

        {/* Bus markers */}
        {buses.map((bus) => (
          <BusMarker
            key={bus.id}
            bus={bus}
            onClick={() => onBusClick?.(bus)}
          />
        ))}

        {/* User location */}
        {userLocation && <UserLocationMarker position={userLocation} />}
      </GoogleMap>

      {/* Map controls */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-2">
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={centerOnUser}
          className="h-12 w-12 rounded-full bg-card/90 backdrop-blur-sm shadow-lg flex items-center justify-center hover:bg-accent transition-colors"
        >
          <NavigationArrow weight="fill" className="h-6 w-6 text-blue-500" />
        </motion.button>
      </div>
    </div>
  )
}

// Stop marker component
interface StopMarkerProps {
  stop: BusStop
  isSelected?: boolean
  onClick?: () => void
}

function StopMarker({ stop, isSelected, onClick }: StopMarkerProps) {
  return (
    <OverlayView
      position={{ lat: stop.latitude, lng: stop.longitude }}
      mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
    >
      <motion.button
        onClick={onClick}
        whileHover={{ scale: 1.2 }}
        whileTap={{ scale: 0.9 }}
        animate={{ scale: isSelected ? 1.3 : 1 }}
        className={cn(
          'relative flex items-center justify-center -translate-x-1/2 -translate-y-1/2',
          'h-8 w-8 rounded-full',
          isSelected 
            ? 'bg-primary shadow-lg shadow-primary/50' 
            : 'bg-card border-2 border-primary/50 shadow-md'
        )}
      >
        <MapPin className={cn(
          'h-4 w-4',
          isSelected ? 'text-primary-foreground' : 'text-primary'
        )} />
        {isSelected && (
          <motion.div
            initial={{ scale: 1, opacity: 0.5 }}
            animate={{ scale: 2, opacity: 0 }}
            transition={{ duration: 1.5, repeat: Infinity }}
            className="absolute inset-0 rounded-full bg-primary"
          />
        )}
      </motion.button>
    </OverlayView>
  )
}

// Animated bus marker
interface BusMarkerProps {
  bus: BusType
  onClick?: () => void
}

function BusMarker({ bus, onClick }: BusMarkerProps) {
  const [position, setPosition] = useState(bus.currentPosition)

  // Smooth position animation
  useEffect(() => {
    setPosition(bus.currentPosition)
  }, [bus.currentPosition])

  return (
    <OverlayView
      position={{ lat: position.latitude, lng: position.longitude }}
      mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
    >
      <motion.button
        onClick={onClick}
        initial={{ opacity: 0, scale: 0 }}
        animate={{ 
          opacity: 1, 
          scale: 1,
          rotate: bus.heading,
        }}
        transition={{
          type: 'spring',
          stiffness: 100,
          damping: 20,
        }}
        whileHover={{ scale: 1.15 }}
        whileTap={{ scale: 0.95 }}
        className="relative flex items-center justify-center -translate-x-1/2 -translate-y-1/2"
      >
        {/* Bus body */}
        <div className="relative">
          <div className="h-10 w-10 rounded-xl bg-primary shadow-lg shadow-primary/40 flex items-center justify-center">
            <Bus className="h-5 w-5 text-primary-foreground" />
          </div>
          {/* Direction indicator */}
          <div 
            className="absolute -top-1 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-b-[8px] border-l-transparent border-r-transparent border-b-primary"
            style={{ transform: `translateX(-50%)` }}
          />
          {/* Route badge */}
          <div className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-card text-[10px] font-bold flex items-center justify-center border border-border">
            {bus.routeName}
          </div>
        </div>
      </motion.button>
    </OverlayView>
  )
}

// User location marker with pulse
interface UserLocationMarkerProps {
  position: { lat: number; lng: number }
}

function UserLocationMarker({ position }: UserLocationMarkerProps) {
  return (
    <OverlayView
      position={position}
      mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
    >
      <div className="relative flex items-center justify-center -translate-x-1/2 -translate-y-1/2">
        {/* Pulse rings */}
        <motion.div
          initial={{ scale: 1, opacity: 0.6 }}
          animate={{ scale: 2.5, opacity: 0 }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
          className="absolute h-8 w-8 rounded-full bg-blue-500/30"
        />
        <motion.div
          initial={{ scale: 1, opacity: 0.4 }}
          animate={{ scale: 2, opacity: 0 }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeOut', delay: 0.5 }}
          className="absolute h-8 w-8 rounded-full bg-blue-500/30"
        />
        {/* Center dot */}
        <div className="h-4 w-4 rounded-full bg-blue-500 border-2 border-white shadow-lg" />
      </div>
    </OverlayView>
  )
}

export default TransitMap
